"""
LOROsTools Worker
─────────────────
Polls for queued jobs and dispatches them to the appropriate processor
based on app_key. Each processor lives in processors/<app_key>.py.
"""

import os
import time
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import DateTime, Integer, String, Text, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from processors import REGISTRY
from processors.base import JobContext


# ── Config ───────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "")
FILES_ROOT = os.getenv("FILES_ROOT", "/data/files")
POLL_SECONDS = float(os.getenv("WORKER_POLL_SECONDS", "2"))


# ── ORM (mirrors the API model — worker only needs read/write) ─

class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    app_key: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False)
    progress: Mapped[int] = mapped_column(Integer, nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)

    template_path: Mapped[str | None] = mapped_column(String(512))
    output_path: Mapped[str | None] = mapped_column(String(512))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


engine = create_engine(DATABASE_URL, pool_pre_ping=True)


# ── Dispatcher ───────────────────────────────────────────────

def _build_context(job: Job, db: Session) -> JobContext:
    """Build a JobContext for the given job, wiring up the progress callback."""
    files_root = Path(FILES_ROOT)
    job_dir = files_root / "jobs" / str(job.id)

    template_abs = None
    if job.template_path:
        template_abs = (files_root / job.template_path).resolve()

    def report_progress(percent: int, message: str) -> None:
        """Update job progress in DB (called from within a processor)."""
        job.progress = min(percent, 99)  # 100 is set only on completion
        job.message = message
        db.commit()

    return JobContext(
        job_id=job.id,
        app_key=job.app_key,
        params=job.params or {},
        files_root=files_root,
        inputs_dir=job_dir / "inputs",
        output_dir=job_dir / "output",
        template_abs=template_abs,
        report_progress=report_progress,
    )


def _process_job(job: Job, db: Session) -> str:
    """Dispatch job to the correct processor. Returns relative output path."""
    processor_fn = REGISTRY.get(job.app_key)

    if processor_fn is None:
        raise ValueError(
            f"No processor registered for app_key='{job.app_key}'. "
            f"Available: {', '.join(REGISTRY.keys())}"
        )

    ctx = _build_context(job, db)
    return processor_fn(ctx)


# ── Main loop ────────────────────────────────────────────────

def main() -> None:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")

    print(f"[worker] starting | poll={POLL_SECONDS}s | files_root={FILES_ROOT}")
    print(f"[worker] registered processors: {', '.join(REGISTRY.keys())}")

    while True:
        try:
            with Session(engine) as db:
                job = db.execute(
                    select(Job)
                    .where(Job.status == "queued")
                    .order_by(Job.created_at.asc())
                    .limit(1)
                ).scalar_one_or_none()

                if not job:
                    time.sleep(POLL_SECONDS)
                    continue

                print(f"[worker] picked up job {job.id} (app={job.app_key})")

                job.status = "running"
                job.progress = 5
                job.message = "Iniciando procesamiento..."
                db.commit()

                try:
                    out_rel = _process_job(job, db)
                    job.output_path = out_rel
                    job.status = "succeeded"
                    job.progress = 100
                    job.message = "Completado"
                    print(f"[worker] job {job.id} succeeded → {out_rel}")
                except Exception as e:
                    job.status = "failed"
                    job.progress = 100
                    job.message = f"Error: {e}"
                    print(f"[worker] job {job.id} failed: {e}")

                db.commit()

        except Exception as e:
            print(f"[worker] loop error: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
