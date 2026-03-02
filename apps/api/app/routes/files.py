import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.deps import require_user

router = APIRouter()


def _safe_filename(name: str) -> str:
    name = name.strip().replace("\\", "/")
    name = name.split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:180] or "file"


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    root = Path(settings.files_root)
    root.mkdir(parents=True, exist_ok=True)

    filename = _safe_filename(file.filename or "upload")
    dest = root / "uploads" / filename
    dest.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    with dest.open("wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)

    return {"filename": filename, "bytes": size}
