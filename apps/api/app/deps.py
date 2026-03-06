from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.models import User, UserAppPermission
from app.db.session import get_db


def _extract_token(request: Request) -> str | None:
    # 1) Try cookie first (production, same-domain)
    token = request.cookies.get("access_token")

    # 2) Fall back to Authorization: Bearer <token> (dev, cross-origin)
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    return token


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    username = decode_access_token(token)
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def ensure_app_access(user: User, app_key: str, db: Session) -> None:
    if user.is_admin:
        return

    has_permission = (
        db.query(UserAppPermission.id)
        .filter(UserAppPermission.user_id == user.id, UserAppPermission.app_key == app_key)
        .first()
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="No tienes permiso para esta app")
