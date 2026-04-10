from __future__ import annotations

import io
import json
import re
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.models import AppDefinition, User, UserAppPermission
from app.db.session import get_db
from app.deps import require_user
from app.services.treasury_parser import (
    TreasuryStatement,
    analysis_payload,
    parse_statement,
    statement_from_payload,
    statements_from_analysis_json,
)
from app.services.treasury_template import (
    MOVEMENT_FIELD_LABELS,
    prepare_balance_template,
    prepare_movement_template,
    render_balance_workbook,
    render_movement_workbook,
)


router = APIRouter(prefix="/tools/tesoreria/bank-movements", tags=["tools-tesoreria-bank-movements"])

TREASURY_APP_KEYS = (
    "tesoreria_automatizacion_saldos",
    "tesoreria_generacion_conciliacion",
)


def _template_ext_ok(filename: str | None) -> bool:
    return Path(filename or "").suffix.lower() in {".xlsx", ".xlsm"}


def _ensure_treasury_access(db: Session, user: User) -> None:
    available_keys = [
        app_key
        for app_key in TREASURY_APP_KEYS
        if (app := db.get(AppDefinition, app_key)) and app.enabled
    ]
    if not available_keys:
        raise HTTPException(status_code=404, detail="La herramienta de Tesorería no está disponible.")

    if user.is_admin:
        return

    has_permission = (
        db.query(UserAppPermission.id)
        .filter(UserAppPermission.user_id == user.id, UserAppPermission.app_key.in_(available_keys))
        .first()
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="No tienes permiso para esta herramienta de Tesorería.")


def _save_upload(upload: UploadFile, root: Path, fallback_name: str) -> Path:
    safe_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", Path(upload.filename or fallback_name).name)
    target = root / safe_name
    target.write_bytes(upload.file.read())
    upload.file.seek(0)
    return target


async def _parse_uploaded_statements(files: list[UploadFile], root: Path) -> list[TreasuryStatement]:
    statements: list[TreasuryStatement] = []
    for index, upload in enumerate(files):
        safe_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", Path(upload.filename or f"file_{index}.pdf").name)
        target = root / f"{index:02d}-{safe_name}"
        target.write_bytes(await upload.read())
        statements.extend(parse_statement(target))
    return statements


async def _resolve_input_statements(
    files: list[UploadFile] | None,
    analysis_json: str | None,
    root: Path,
) -> list[TreasuryStatement]:
    statements = _statements_from_analysis_json_http(analysis_json)
    if statements is not None:
        return statements

    valid_files = [item for item in (files or []) if item.filename]
    if not valid_files:
        raise HTTPException(status_code=400, detail="Debes subir al menos un PDF.")

    for item in valid_files:
        if Path(item.filename or "").suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail=f"Solo se permiten archivos PDF. Recibí: {item.filename}")

    return await _parse_uploaded_statements(valid_files, root)


def _statements_from_analysis_json_http(analysis_json: str | None) -> list[TreasuryStatement] | None:
    if not analysis_json or not analysis_json.strip():
        return None

    try:
        result = statements_from_analysis_json(analysis_json)
    except (json.JSONDecodeError, Exception) as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el análisis enviado: {exc}") from exc

    if result is None:
        raise HTTPException(status_code=400, detail="El análisis enviado no tiene el formato esperado.")
    return result


@router.post("/analyze")
async def analyze_bank_movements(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    _ensure_treasury_access(db, user)

    valid_files = [item for item in files if item.filename]
    if not valid_files:
        raise HTTPException(status_code=400, detail="Debes subir al menos un PDF.")

    for item in valid_files:
        if Path(item.filename or "").suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail=f"Solo se permiten archivos PDF. Recibí: {item.filename}")

    with tempfile.TemporaryDirectory(prefix="bank-movements-") as temp_dir:
        root = Path(temp_dir)
        statements = await _parse_uploaded_statements(valid_files, root)

    return analysis_payload(statements)


@router.post("/prepare")
async def prepare_bank_templates(
    files: list[UploadFile] | None = File(default=None),
    movements_template: UploadFile | None = File(None),
    balances_template: UploadFile | None = File(None),
    analysis_json: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    _ensure_treasury_access(db, user)

    if movements_template and not _template_ext_ok(movements_template.filename):
        raise HTTPException(status_code=400, detail="El Excel de movimientos debe ser .xlsx o .xlsm.")
    if balances_template and not _template_ext_ok(balances_template.filename):
        raise HTTPException(status_code=400, detail="El Excel de saldos debe ser .xlsx o .xlsm.")

    with tempfile.TemporaryDirectory(prefix="bank-movements-prepare-") as temp_dir:
        root = Path(temp_dir)
        statements = await _resolve_input_statements(files, analysis_json, root)

        movement_template_data = None
        balance_template_data = None
        if movements_template and movements_template.filename:
            movement_path = _save_upload(movements_template, root, "movimientos.xlsx")
            movement_template_data = prepare_movement_template(movement_path, statements)
        if balances_template and balances_template.filename:
            balance_path = _save_upload(balances_template, root, "saldos.xlsx")
            balance_template_data = prepare_balance_template(balance_path, statements)

    return {
        "analysis": analysis_payload(statements),
        "movement_template": movement_template_data,
        "balances_template": balance_template_data,
    }


@router.post("/export")
async def export_bank_templates(
    movements_template: UploadFile | None = File(None),
    balances_template: UploadFile | None = File(None),
    drafts_json: str = Form("[]"),
    balance_updates_json: str = Form("[]"),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    _ensure_treasury_access(db, user)

    if not movements_template and not balances_template:
        raise HTTPException(status_code=400, detail="Debes subir al menos uno de los Excel para exportar.")
    if movements_template and not _template_ext_ok(movements_template.filename):
        raise HTTPException(status_code=400, detail="El Excel de movimientos debe ser .xlsx o .xlsm.")
    if balances_template and not _template_ext_ok(balances_template.filename):
        raise HTTPException(status_code=400, detail="El Excel de saldos debe ser .xlsx o .xlsm.")

    try:
        drafts = json.loads(drafts_json or "[]")
        balance_updates = json.loads(balance_updates_json or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo leer la configuración enviada: {exc}") from exc

    with tempfile.TemporaryDirectory(prefix="bank-movements-export-") as temp_dir:
        root = Path(temp_dir)
        rendered_files: list[tuple[str, bytes]] = []

        if movements_template and movements_template.filename:
            movement_path = _save_upload(movements_template, root, "movimientos.xlsx")
            movement_bytes = render_movement_workbook(movement_path, drafts if isinstance(drafts, list) else [])
            movement_name = f"{movement_path.stem}_actualizado{movement_path.suffix}"
            rendered_files.append((movement_name, movement_bytes))

        if balances_template and balances_template.filename:
            balance_path = _save_upload(balances_template, root, "saldos.xlsx")
            balance_bytes = render_balance_workbook(balance_path, balance_updates if isinstance(balance_updates, list) else [])
            balance_name = f"{balance_path.stem}_actualizado{balance_path.suffix}"
            rendered_files.append((balance_name, balance_bytes))

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for filename, content in rendered_files:
            archive.writestr(filename, content)
    zip_buffer.seek(0)

    headers = {"Content-Disposition": 'attachment; filename="tesoreria_actualizada.zip"'}
    return StreamingResponse(zip_buffer, media_type="application/zip", headers=headers)
