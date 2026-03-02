import json
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import AppDefinition, Job, JobFile
from app.db.session import get_db
from app.deps import require_user

router = APIRouter()


def _safe_filename(name: str) -> str:
    name = name.strip().replace("\\", "/")
    name = name.split("/")[-1]
    # keep letters, numbers, dot, dash, underscore
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:180] or "file"


def _write_upload(root: Path, rel_path: str, f: UploadFile) -> tuple[str, int | None]:
    """Write UploadFile under root/rel_path. Returns (rel_path, size_bytes)."""
    abs_path = (root / rel_path).resolve()
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    with abs_path.open("wb") as out:
        while True:
            chunk = f.file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            size += len(chunk)

    return rel_path, size


@router.get("")
def list_apps(
    unit: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    q = db.query(AppDefinition)
    if unit:
        q = q.filter(AppDefinition.unit == unit)

    apps = q.order_by(AppDefinition.unit, AppDefinition.key).all()
    return [
        {
            "key": a.key,
            "name": a.name,
            "unit": a.unit,
            "enabled": a.enabled,
            "mode": a.mode,
            "ui": {"type": a.ui_type, "url": a.ui_url},
            "spec": a.spec,
        }
        for a in apps
    ]


@router.get("/{key}")
def get_app(key: str, db: Session = Depends(get_db), user=Depends(require_user)):
    app = db.get(AppDefinition, key)
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    return {
        "key": app.key,
        "name": app.name,
        "unit": app.unit,
        "enabled": app.enabled,
        "mode": app.mode,
        "ui": {"type": app.ui_type, "url": app.ui_url},
        "spec": app.spec,
    }


# ── app-specific validators ────────────────────────────────────────────


def _validate_tesoreria_saldos(inputs, template):
    if not inputs or len(inputs) == 0:
        raise HTTPException(status_code=400, detail="inputs are required (at least 1 PDF)")
    if template is None:
        raise HTTPException(status_code=400, detail="template is required for tesoreria_automatizacion_saldos")
    for f in inputs:
        name = (f.filename or "").lower()
        if not name.endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"All inputs must be PDFs. Got: {f.filename}")
    tname = (template.filename or "").lower()
    if not (tname.endswith(".xlsx") or tname.endswith(".xls")):
        raise HTTPException(status_code=400, detail=f"Template must be an Excel file. Got: {template.filename}")


@router.post("/{key}/jobs")
async def create_job(
    key: str,
    inputs: list[UploadFile] = File(...),
    template: UploadFile | None = File(default=None),
    params_json: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    app = db.get(AppDefinition, key)
    if not app or not app.enabled:
        raise HTTPException(status_code=404, detail="App not found")

    if app.mode != "batch":
        raise HTTPException(
            status_code=400,
            detail="This app is interactive; it should be used from the portal UI.",
        )

    # --- app-specific validation ---
    if app.key == "tesoreria_automatizacion_saldos":
        _validate_tesoreria_saldos(inputs, template)

    if app.key == "tesoreria_generacion_conciliacion":
        if not inputs or len(inputs) == 0:
            raise HTTPException(status_code=400, detail="inputs are required (at least 1 PDF)")

    # params
    params: dict[str, Any] = {}
    if params_json:
        try:
            params = json.loads(params_json)
            if not isinstance(params, dict):
                raise ValueError("params_json must be an object")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid params_json: {e}")

    job = Job(app_key=app.key, created_by=user.username, status="queued", params=params)
    db.add(job)
    db.flush()  # materialize job.id

    files_root = Path(settings.files_root)
    job_root_rel = f"jobs/{job.id}"

    # inputs
    for idx, f in enumerate(inputs or []):
        fn = _safe_filename(f.filename or f"input_{idx}")
        rel = f"{job_root_rel}/inputs/{idx:02d}-{fn}"
        rel, size = _write_upload(files_root, rel, f)
        db.add(
            JobFile(
                job_id=job.id,
                role="input",
                filename=fn,
                content_type=f.content_type,
                size_bytes=size,
                path=rel,
            )
        )

    # template
    if template is not None:
        fn = _safe_filename(template.filename or "template.xlsx")
        rel = f"{job_root_rel}/template/{fn}"
        rel, size = _write_upload(files_root, rel, template)
        job.template_path = rel
        db.add(
            JobFile(
                job_id=job.id,
                role="template",
                filename=fn,
                content_type=template.content_type,
                size_bytes=size,
                path=rel,
            )
        )

    db.commit()

    return {
        "id": str(job.id),
        "app_key": job.app_key,
        "status": job.status,
        "created_by": job.created_by,
        "created_at": job.created_at,
    }
