"""
LOROsTools Worker
---------------
Polls for queued jobs and dispatches them to the appropriate processor
based on app_key. Each processor lives in processors/<app_key>.py.
"""

import mimetypes
import os
import time
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path

from sqlalchemy import DateTime, Integer, String, Text, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from processors import REGISTRY
from processors.base import JobContext


# Config
DATABASE_URL = os.getenv("DATABASE_URL", "")
FILES_ROOT = os.getenv("FILES_ROOT", "/data/files")
POLL_SECONDS = float(os.getenv("WORKER_POLL_SECONDS", "2"))


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


class JobFile(Base):
    __tablename__ = "job_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def _build_context(job: Job, db: Session) -> JobContext:
    files_root = Path(FILES_ROOT)
    job_dir = files_root / "jobs" / str(job.id)

    template_abs = None
    if job.template_path:
        template_abs = (files_root / job.template_path).resolve()

    def report_progress(percent: int, message: str) -> None:
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
    processor_fn = REGISTRY.get(job.app_key)

    if processor_fn is None:
        raise ValueError(
            f"No processor registered for app_key='{job.app_key}'. "
            f"Available: {', '.join(REGISTRY.keys())}"
        )

    ctx = _build_context(job, db)
    out_rel = processor_fn(ctx)
    job.params = deepcopy(ctx.params or {})
    return out_rel


def _rel_path(files_root: Path, abs_path: Path) -> str:
    return abs_path.relative_to(files_root).as_posix()


def _register_output_files(job: Job, out_rel: str, db: Session) -> str:
    files_root = Path(FILES_ROOT).resolve()
    output_dir = (files_root / "jobs" / str(job.id) / "output").resolve()

    db.query(JobFile).filter(JobFile.job_id == job.id, JobFile.role == "output").delete()

    output_files: list[Path] = []
    if output_dir.exists():
        output_files = sorted(p for p in output_dir.iterdir() if p.is_file())

    for abs_path in output_files:
        guessed_type = mimetypes.guess_type(abs_path.name)[0]
        db.add(
            JobFile(
                job_id=job.id,
                role="output",
                filename=abs_path.name,
                content_type=guessed_type,
                size_bytes=abs_path.stat().st_size,
                path=_rel_path(files_root, abs_path),
            )
        )

    primary_abs = (files_root / out_rel).resolve()
    if not primary_abs.exists() and output_files:
        primary_abs = output_files[0]

    if not primary_abs.exists():
        raise FileNotFoundError("Processor completed but no output file was generated")

    return _rel_path(files_root, primary_abs)


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
                    job.output_path = _register_output_files(job, out_rel, db)
                    job.status = "succeeded"
                    job.progress = 100
                    job.message = "Completado"
                    print(f"[worker] job {job.id} succeeded -> {job.output_path}")
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
