from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import User, UserAppPermission
from app.db.session import get_db
from app.deps import require_user

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _validate_new_password(raw: str) -> None:
    if len(raw) < 8:
        raise HTTPException(status_code=400, detail="La nueva contrasena debe tener al menos 8 caracteres")


def _get_app_permissions(user: User, db: Session) -> list[str]:
    rows = (
        db.query(UserAppPermission.app_key)
        .filter(UserAppPermission.user_id == user.id)
        .order_by(UserAppPermission.app_key.asc())
        .all()
    )
    return [row[0] for row in rows]


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(sub=user.username)
    app_permissions = _get_app_permissions(user, db)

    # cookie settings
    cookie_params = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
    if settings.cookie_domain:
        cookie_params["domain"] = settings.cookie_domain

    response = {
        "ok": True,
        "token": token,
        "user": {
            "username": user.username,
            "is_admin": user.is_admin,
            "app_permissions": app_permissions,
        },
    }

    from fastapi.responses import JSONResponse

    resp = JSONResponse(response)
    resp.set_cookie(key="access_token", value=token, max_age=60 * 60 * 24, **cookie_params)
    return resp


@router.post("/logout")
def logout():
    from fastapi.responses import JSONResponse

    resp = JSONResponse({"ok": True})
    resp.delete_cookie(key="access_token", path="/")
    return resp


@router.get("/me")
def me(user=Depends(require_user), db: Session = Depends(get_db)):
    return {
        "username": user.username,
        "is_admin": user.is_admin,
        "app_permissions": _get_app_permissions(user, db),
    }


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Contrasena actual incorrecta")

    _validate_new_password(payload.new_password)

    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="La nueva contrasena debe ser diferente")

    user.password_hash = hash_password(payload.new_password)
    db.commit()

    return {"ok": True}
