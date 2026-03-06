import json
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import AppDefinition, Job, JobFile, User, UserAppPermission
from app.db.session import get_db
from app.deps import ensure_app_access, require_user

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


def _ext(filename: str | None) -> str:
    if not filename:
        return ""
    return Path(filename).suffix.lower()


def _has_any_ext(files: list[UploadFile], allowed_exts: set[str]) -> bool:
    return any(_ext(f.filename) in allowed_exts for f in files)


def _ensure_all_ext(files: list[UploadFile], allowed_exts: set[str], detail: str) -> None:
    for f in files:
        if _ext(f.filename) not in allowed_exts:
            raise HTTPException(status_code=400, detail=f"{detail}: {f.filename}")


def _validate_tesoreria_saldos(inputs: list[UploadFile], template: UploadFile | None) -> None:
    if not inputs:
        raise HTTPException(status_code=400, detail="inputs are required (at least 1 PDF)")
    if template is None:
        raise HTTPException(
            status_code=400,
            detail="template is required for tesoreria_automatizacion_saldos",
        )

    _ensure_all_ext(inputs, {".pdf"}, "All inputs must be PDFs")
    if _ext(template.filename) not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail=f"Template must be an Excel file. Got: {template.filename}")


def _validate_era_compras_oc(inputs: list[UploadFile], template: UploadFile | None) -> None:
    if not inputs:
        raise HTTPException(status_code=400, detail="inputs are required (at least 1 PDF)")

    _ensure_all_ext(inputs, {".pdf"}, "All inputs must be PDFs")

    if template is None:
        raise HTTPException(
            status_code=400,
            detail="template is required for era_compras_generador_ordenes_compra",
        )
    if _ext(template.filename) not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail=f"Template must be an Excel file. Got: {template.filename}")


def _validate_era_ventas_comisionador(inputs: list[UploadFile], template: UploadFile | None) -> None:
    if not inputs:
        raise HTTPException(
            status_code=400,
            detail="inputs are required: base_comisiones (.xlsx) and schema (.xlsm as template or input)",
        )

    if not _has_any_ext(inputs, {".xlsx", ".xls"}):
        raise HTTPException(status_code=400, detail="At least one Excel (.xlsx/.xls) input is required")

    schema_in_inputs = _has_any_ext(inputs, {".xlsm"})
    schema_in_template = template is not None and _ext(template.filename) == ".xlsm"
    if not schema_in_inputs and not schema_in_template:
        raise HTTPException(
            status_code=400,
            detail="Schema (.xlsm) is required as template or additional input",
        )


def _validate_era_proyectos_cfe(inputs: list[UploadFile], template: UploadFile | None) -> None:
    if not inputs:
        raise HTTPException(status_code=400, detail="inputs are required (at least 1 PDF)")

    _ensure_all_ext(inputs, {".pdf"}, "All inputs must be PDFs")

    if template is not None and _ext(template.filename) not in {".xlsx", ".xls"}:
        raise HTTPException(
            status_code=400,
            detail=f"Template must be an Excel file when provided. Got: {template.filename}",
        )


@router.get("")
def list_apps(
    unit: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    q = db.query(AppDefinition)

    if not user.is_admin:
        q = q.join(UserAppPermission, UserAppPermission.app_key == AppDefinition.key).filter(
            UserAppPermission.user_id == user.id
        )

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
def get_app(key: str, db: Session = Depends(get_db), user: User = Depends(require_user)):
    app = db.get(AppDefinition, key)
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    ensure_app_access(user, app.key, db)

    return {
        "key": app.key,
        "name": app.name,
        "unit": app.unit,
        "enabled": app.enabled,
        "mode": app.mode,
        "ui": {"type": app.ui_type, "url": app.ui_url},
        "spec": app.spec,
    }


@router.post("/{key}/jobs")
async def create_job(
    key: str,
    inputs: list[UploadFile] = File(...),
    template: UploadFile | None = File(default=None),
    params_json: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    app = db.get(AppDefinition, key)
    if not app or not app.enabled:
        raise HTTPException(status_code=404, detail="App not found")

    ensure_app_access(user, app.key, db)

    if app.mode != "batch":
        raise HTTPException(
            status_code=400,
            detail="This app is interactive; it should be used from the portal UI.",
        )

    # app-specific validation
    if app.key == "tesoreria_automatizacion_saldos":
        _validate_tesoreria_saldos(inputs, template)

    if app.key == "era_compras_generador_ordenes_compra":
        _validate_era_compras_oc(inputs, template)

    if app.key == "era_ventas_comisionador":
        _validate_era_ventas_comisionador(inputs, template)

    if app.key == "era_proyectos_comisionador_cfe":
        _validate_era_proyectos_cfe(inputs, template)

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
