import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Job
from app.db.session import get_db
from app.deps import require_user

router = APIRouter()


def _parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job id")


@router.get("")
def list_jobs(
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    limit = max(1, min(limit, 200))

    q = db.query(Job).order_by(Job.created_at.desc())
    if not user.is_admin:
        q = q.filter(Job.created_by == user.username)

    jobs = q.limit(limit).all()
    return [
        {
            "id": str(j.id),
            "app_key": j.app_key,
            "status": j.status,
            "progress": j.progress,
            "message": j.message,
            "created_by": j.created_by,
            "created_at": j.created_at,
            "updated_at": j.updated_at,
            "has_output": bool(j.output_path),
        }
        for j in jobs
    ]


@router.get("/{job_id}")
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    job_uuid = _parse_uuid(job_id)
    job = db.get(Job, job_uuid)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not user.is_admin and job.created_by != user.username:
        raise HTTPException(status_code=403, detail="Forbidden")

    return {
        "id": str(job.id),
        "app_key": job.app_key,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "params": job.params,
        "template_path": job.template_path,
        "output_path": job.output_path,
        "created_by": job.created_by,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


@router.get("/{job_id}/download")
def download_job_output(
    job_id: str,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    job_uuid = _parse_uuid(job_id)
    job = db.get(Job, job_uuid)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not user.is_admin and job.created_by != user.username:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not job.output_path:
        raise HTTPException(status_code=404, detail="No output available")

    files_root = Path(settings.files_root)
    abs_path = (files_root / job.output_path).resolve()
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing")

    return FileResponse(
        path=str(abs_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=abs_path.name,
    )
