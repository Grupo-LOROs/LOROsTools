from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.models import User
from app.db.session import get_db


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    # 1. Try cookie first (production, same-domain)
    token = request.cookies.get("access_token")

    # 2. Fall back to Authorization: Bearer <token> (dev, cross-origin)
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    username = decode_access_token(token)
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    return user
