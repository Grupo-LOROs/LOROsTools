import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import AppDefinition, User, UserAppPermission
from app.db.session import get_db
from app.deps import require_admin

router = APIRouter()

USERNAME_RX = re.compile(r"^[A-Za-z0-9._-]{3,64}$")


class UserCreateRequest(BaseModel):
    username: str
    password: str
    is_admin: bool = False
    app_keys: list[str] = Field(default_factory=list)


class UserPermissionUpdateRequest(BaseModel):
    is_admin: bool
    app_keys: list[str] = Field(default_factory=list)


class AdminResetPasswordRequest(BaseModel):
    new_password: str


def _validate_username(raw: str) -> str:
    username = raw.strip()
    if not USERNAME_RX.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username invalido. Usa 3-64 caracteres: letras, numeros, punto, guion o guion_bajo",
        )
    return username


def _validate_password(raw: str) -> None:
    if len(raw) < 8:
        raise HTTPException(status_code=400, detail="La contrasena debe tener al menos 8 caracteres")


def _normalize_app_keys(app_keys: list[str]) -> list[str]:
    cleaned = [k.strip() for k in app_keys if isinstance(k, str) and k.strip()]
    return sorted(set(cleaned))


def _validate_app_keys_exist(app_keys: list[str], db: Session) -> None:
    if not app_keys:
        return

    existing = {
        row[0]
        for row in db.query(AppDefinition.key)
        .filter(AppDefinition.key.in_(app_keys))
        .all()
    }
    missing = sorted(set(app_keys) - existing)
    if missing:
        raise HTTPException(status_code=400, detail=f"Apps invalidas: {', '.join(missing)}")


def _validate_user_scope(is_admin: bool, app_keys: list[str]) -> None:
    if not is_admin and not app_keys:
        raise HTTPException(status_code=400, detail="Asigna al menos una app para usuarios no admin")


def _set_user_permissions(user: User, app_keys: list[str], db: Session) -> None:
    db.query(UserAppPermission).filter(UserAppPermission.user_id == user.id).delete()
    for app_key in app_keys:
        db.add(UserAppPermission(user_id=user.id, app_key=app_key))


def _serialize_user(user: User, app_keys: list[str]) -> dict:
    return {
        "username": user.username,
        "is_admin": user.is_admin,
        "app_keys": app_keys,
        "created_at": user.created_at,
    }


@router.get("")
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    users = db.query(User).order_by(User.username.asc()).all()
    permissions = db.query(UserAppPermission).all()

    app_map: dict[int, list[str]] = {}
    for p in permissions:
        app_map.setdefault(p.user_id, []).append(p.app_key)

    return [_serialize_user(u, sorted(app_map.get(u.id, []))) for u in users]


@router.get("/apps")
def list_apps_for_permissions(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    apps = db.query(AppDefinition).order_by(AppDefinition.unit.asc(), AppDefinition.name.asc()).all()
    return [
        {
            "key": a.key,
            "name": a.name,
            "unit": a.unit,
            "mode": a.mode,
            "enabled": a.enabled,
        }
        for a in apps
    ]


@router.post("")
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    username = _validate_username(payload.username)
    _validate_password(payload.password)
    app_keys = _normalize_app_keys(payload.app_keys)
    _validate_app_keys_exist(app_keys, db)
    _validate_user_scope(payload.is_admin, app_keys)

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese username")

    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.flush()

    if not payload.is_admin:
        _set_user_permissions(user, app_keys, db)

    db.commit()
    return _serialize_user(user, [] if payload.is_admin else app_keys)


@router.put("/{username}/permissions")
def update_user_permissions(
    username: str,
    payload: UserPermissionUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    app_keys = _normalize_app_keys(payload.app_keys)
    _validate_app_keys_exist(app_keys, db)
    _validate_user_scope(payload.is_admin, app_keys)

    user.is_admin = payload.is_admin
    if payload.is_admin:
        db.query(UserAppPermission).filter(UserAppPermission.user_id == user.id).delete()
        assigned_keys: list[str] = []
    else:
        _set_user_permissions(user, app_keys, db)
        assigned_keys = app_keys

    db.commit()
    return _serialize_user(user, assigned_keys)


@router.post("/{username}/reset-password")
def admin_reset_password(
    username: str,
    payload: AdminResetPasswordRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    _validate_password(payload.new_password)
    user.password_hash = hash_password(payload.new_password)
    db.commit()

    return {"ok": True}


@router.delete("/{username}")
def delete_user(
    username: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if user.username == admin.username:
        raise HTTPException(status_code=400, detail="No puedes borrar tu propio usuario")

    if user.username == "admin":
        raise HTTPException(status_code=400, detail="No se puede borrar el usuario admin principal")

    db.delete(user)
    db.commit()
    return {"ok": True}
