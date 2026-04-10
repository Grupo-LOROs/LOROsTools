from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.models import Announcement, User, UserAppPermission
from app.db.session import get_db
from app.deps import require_user

router = APIRouter()


@router.get("")
def list_announcements(
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    now = datetime.now(timezone.utc)

    q = db.query(Announcement).filter(
        Announcement.active.is_(True),
        (Announcement.expires_at.is_(None)) | (Announcement.expires_at > now),
    )

    announcements = q.order_by(Announcement.created_at.desc()).all()

    if user.is_admin:
        visible = announcements
    else:
        user_app_keys = {
            row[0]
            for row in db.query(UserAppPermission.app_key)
            .filter(UserAppPermission.user_id == user.id)
            .all()
        }

        visible = []
        for ann in announcements:
            if not ann.app_keys:
                # global announcement
                visible.append(ann)
            elif set(ann.app_keys) & user_app_keys:
                # user has permission to at least one associated app
                visible.append(ann)

    return [
        {
            "id": a.id,
            "slug": a.slug,
            "title": a.title,
            "body": a.body,
            "level": a.level,
            "app_keys": a.app_keys,
            "created_at": a.created_at,
            "expires_at": a.expires_at,
        }
        for a in visible
    ]
