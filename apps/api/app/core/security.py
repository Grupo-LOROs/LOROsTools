import time
import jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status
from .config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 8  # 8h

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)

def create_access_token(sub: str) -> str:
    now = int(time.time())
    payload = {"sub": sub, "iat": now, "exp": now + ACCESS_TOKEN_TTL_SECONDS}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

def decode_access_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
