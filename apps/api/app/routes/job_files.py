from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Job, JobFile, User
from app.db.session import get_db
from app.deps import require_user

router = APIRouter(prefix="/jobs", tags=["jobs"])


def parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job id")


def _ensure_job_visibility(job: Job, user: User) -> None:
    if not user.is_admin and job.created_by != user.username:
        raise HTTPException(status_code=403, detail="Forbidden")


def _resolve_file_path(rel_path: str) -> Path:
    root = Path(settings.files_root).resolve()
    abs_path = (root / rel_path).resolve()
    if not str(abs_path).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid file path")
    return abs_path


@router.get("/{job_id}/files")
def list_job_files(
    job_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    job_uuid = parse_uuid(job_id)
    job = db.query(Job).filter(Job.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    _ensure_job_visibility(job, user)

    files = db.query(JobFile).filter(JobFile.job_id == job_uuid).order_by(JobFile.created_at.asc()).all()

    inputs = []
    template = None
    outputs = []

    for f in files:
        item = {
            "id": f.id,
            "role": f.role,
            "filename": f.filename,
            "content_type": f.content_type,
            "size_bytes": f.size_bytes,
            "path": f.path,
        }
        if item["role"] == "template":
            template = item
        elif item["role"] == "output":
            outputs.append(item)
        else:
            inputs.append(item)

    return {
        "job_id": str(job.id),
        "app_key": job.app_key,
        "inputs": inputs,
        "template": template,
        "outputs": outputs,
        "template_path": job.template_path,
        "output_path": job.output_path,
    }


@router.get("/{job_id}/files/{file_id}/download")
def download_job_file(
    job_id: str,
    file_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    job_uuid = parse_uuid(job_id)
    job = db.query(Job).filter(Job.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    _ensure_job_visibility(job, user)

    job_file = (
        db.query(JobFile)
        .filter(JobFile.job_id == job_uuid, JobFile.id == file_id)
        .first()
    )
    if not job_file:
        raise HTTPException(status_code=404, detail="File not found")

    abs_path = _resolve_file_path(job_file.path)
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File missing")

    media_type = job_file.content_type or mimetypes.guess_type(abs_path.name)[0] or "application/octet-stream"

    return FileResponse(path=str(abs_path), media_type=media_type, filename=job_file.filename)
