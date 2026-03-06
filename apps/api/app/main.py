import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.db.seed import seed
from app.db.session import Base, SessionLocal, engine
from app.routes.apps import router as apps_router
from app.routes.auth import router as auth_router
from app.routes.jobs import router as jobs_router
from app.routes import job_files
from app.routes.users import router as users_router


def _init_db() -> None:
    """Create tables + seed. Includes a small DB readiness retry."""

    # Wait for Postgres (healthcheck can still race a bit)
    for _ in range(30):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            break
        except Exception:
            time.sleep(1)

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    yield


app = FastAPI(title="LOROs Tools API", lifespan=lifespan)

# CORS
allowed = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed if allowed else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(users_router, prefix="/users", tags=["users"])
app.include_router(apps_router, prefix="/apps", tags=["apps"])
app.include_router(jobs_router, prefix="/jobs", tags=["jobs"])
app.include_router(job_files.router)
