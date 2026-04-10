from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Announcement, AppDefinition, AuditEvent, Job, User
from app.db.session import get_db
from app.deps import require_admin

router = APIRouter()


@router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)

    # --- Job stats ---
    total_jobs = db.query(func.count(Job.id)).scalar() or 0

    jobs_by_status = dict(
        db.query(Job.status, func.count(Job.id))
        .group_by(Job.status)
        .all()
    )

    succeeded = jobs_by_status.get("succeeded", 0)
    success_rate = round(succeeded / total_jobs * 100, 1) if total_jobs > 0 else 0

    jobs_7d = (
        db.query(func.count(Job.id))
        .filter(Job.created_at >= seven_days_ago)
        .scalar()
        or 0
    )
    jobs_30d = (
        db.query(func.count(Job.id))
        .filter(Job.created_at >= thirty_days_ago)
        .scalar()
        or 0
    )

    # Top users by jobs
    top_users_jobs = (
        db.query(Job.created_by, func.count(Job.id).label("count"))
        .group_by(Job.created_by)
        .order_by(func.count(Job.id).desc())
        .limit(10)
        .all()
    )

    # Top apps by jobs
    top_apps_jobs = (
        db.query(Job.app_key, func.count(Job.id).label("count"))
        .group_by(Job.app_key)
        .order_by(func.count(Job.id).desc())
        .limit(10)
        .all()
    )

    # --- Audit event stats ---
    logins_7d = (
        db.query(func.count(AuditEvent.id))
        .filter(AuditEvent.event_type == "login", AuditEvent.created_at >= seven_days_ago)
        .scalar()
        or 0
    )
    logins_30d = (
        db.query(func.count(AuditEvent.id))
        .filter(AuditEvent.event_type == "login", AuditEvent.created_at >= thirty_days_ago)
        .scalar()
        or 0
    )

    app_opens_7d = (
        db.query(func.count(AuditEvent.id))
        .filter(AuditEvent.event_type == "app_open", AuditEvent.created_at >= seven_days_ago)
        .scalar()
        or 0
    )
    app_opens_30d = (
        db.query(func.count(AuditEvent.id))
        .filter(AuditEvent.event_type == "app_open", AuditEvent.created_at >= thirty_days_ago)
        .scalar()
        or 0
    )

    active_users_7d = (
        db.query(func.count(func.distinct(AuditEvent.username)))
        .filter(AuditEvent.event_type == "login", AuditEvent.created_at >= seven_days_ago)
        .scalar()
        or 0
    )
    active_users_30d = (
        db.query(func.count(func.distinct(AuditEvent.username)))
        .filter(AuditEvent.event_type == "login", AuditEvent.created_at >= thirty_days_ago)
        .scalar()
        or 0
    )

    # Top apps by opens
    top_apps_opens = (
        db.query(AuditEvent.app_key, func.count(AuditEvent.id).label("count"))
        .filter(AuditEvent.event_type == "app_open", AuditEvent.app_key.isnot(None))
        .group_by(AuditEvent.app_key)
        .order_by(func.count(AuditEvent.id).desc())
        .limit(10)
        .all()
    )

    total_users = db.query(func.count(User.id)).scalar() or 0

    return {
        "total_jobs": total_jobs,
        "jobs_by_status": jobs_by_status,
        "success_rate": success_rate,
        "jobs_7d": jobs_7d,
        "jobs_30d": jobs_30d,
        "logins_7d": logins_7d,
        "logins_30d": logins_30d,
        "app_opens_7d": app_opens_7d,
        "app_opens_30d": app_opens_30d,
        "active_users_7d": active_users_7d,
        "active_users_30d": active_users_30d,
        "total_users": total_users,
        "top_users_jobs": [{"username": u, "count": c} for u, c in top_users_jobs],
        "top_apps_jobs": [{"app_key": a, "count": c} for a, c in top_apps_jobs],
        "top_apps_opens": [{"app_key": a, "count": c} for a, c in top_apps_opens],
    }


@router.get("/activity")
def admin_activity(
    user: str | None = Query(default=None),
    app_key: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Combined activity log from audit_events and jobs."""
    results = []

    # Audit events
    if event_type in (None, "login", "app_open"):
        eq = db.query(AuditEvent)
        if user:
            eq = eq.filter(AuditEvent.username == user)
        if app_key:
            eq = eq.filter(AuditEvent.app_key == app_key)
        if event_type:
            eq = eq.filter(AuditEvent.event_type == event_type)

        events = eq.order_by(AuditEvent.created_at.desc()).limit(limit + offset).all()
        for e in events:
            results.append({
                "timestamp": e.created_at,
                "event_type": e.event_type,
                "username": e.username,
                "app_key": e.app_key,
                "detail": f"IP: {e.ip_address}" if e.ip_address else None,
            })

    # Jobs as events
    if event_type in (None, "job_created"):
        jq = db.query(Job)
        if user:
            jq = jq.filter(Job.created_by == user)
        if app_key:
            jq = jq.filter(Job.app_key == app_key)

        jobs = jq.order_by(Job.created_at.desc()).limit(limit + offset).all()
        for j in jobs:
            results.append({
                "timestamp": j.created_at,
                "event_type": "job_created",
                "username": j.created_by,
                "app_key": j.app_key,
                "detail": f"Estado: {j.status}" + (f" - {j.message}" if j.message else ""),
            })

    # Sort combined results by timestamp desc
    results.sort(key=lambda r: r["timestamp"], reverse=True)

    return {
        "items": results[offset : offset + limit],
        "total": len(results),
        "limit": limit,
        "offset": offset,
    }


@router.get("/announcements")
def admin_announcements(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all announcements (including inactive) for admin management."""
    announcements = db.query(Announcement).order_by(Announcement.created_at.desc()).all()

    now = datetime.now(timezone.utc)
    return [
        {
            "id": a.id,
            "slug": a.slug,
            "title": a.title,
            "body": a.body,
            "level": a.level,
            "app_keys": a.app_keys,
            "active": a.active,
            "expired": a.expires_at is not None and a.expires_at < now,
            "expires_at": a.expires_at,
            "created_at": a.created_at,
        }
        for a in announcements
    ]
