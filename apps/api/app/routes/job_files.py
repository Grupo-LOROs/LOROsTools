from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import Job, JobFile
from app.db.session import get_db
from app.deps import require_user

router = APIRouter(prefix="/jobs", tags=["jobs"])


def parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job id")

@router.get("/{job_id}/files")
def list_job_files(
    job_id: str,
    user=Depends(require_user),
    db: Session = Depends(get_db),
):
    job_uuid = parse_uuid(job_id)
    job = db.query(Job).filter(Job.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    files = db.query(JobFile).filter(JobFile.job_id == job_uuid).order_by(JobFile.created_at.asc()).all()

    # Agrupación amigable
    inputs = []
    template = None
    outputs = []

    for f in files:
        item = {
            "id": getattr(f, "id", None),
            "role": getattr(f, "role", None),
            "filename": f.filename,
            "content_type": getattr(f, "content_type", None),
            "size_bytes": getattr(f, "size_bytes", None),
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