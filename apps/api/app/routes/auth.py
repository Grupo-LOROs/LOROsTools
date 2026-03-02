from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, verify_password
from app.db.models import User
from app.db.session import get_db
from app.deps import require_user

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(sub=user.username)

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
        "user": {"username": user.username, "is_admin": user.is_admin},
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
def me(user=Depends(require_user)):
    return {"username": user.username, "is_admin": user.is_admin}
