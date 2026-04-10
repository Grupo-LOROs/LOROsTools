import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    app_permissions: Mapped[list["UserAppPermission"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AppDefinition(Base):
    __tablename__ = "apps"

    # stable key / slug, ex: "tesoreria_automatizacion_saldos"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # "batch" = file-in/file-out, "interactive" = portal tool
    mode: Mapped[str] = mapped_column(String(20), default="batch", nullable=False)
    ui_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ex: "next" / "iframe"
    ui_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # JSON spec with allowed inputs/outputs + any app-specific config
    spec: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    jobs: Mapped[list["Job"]] = relationship(back_populates="app")
    user_permissions: Mapped[list["UserAppPermission"]] = relationship(
        back_populates="app", cascade="all, delete-orphan"
    )


class UserAppPermission(Base):
    __tablename__ = "user_app_permissions"
    __table_args__ = (UniqueConstraint("user_id", "app_key", name="uq_user_app_permission"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    app_key: Mapped[str] = mapped_column(ForeignKey("apps.key"), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    user: Mapped[User] = relationship(back_populates="app_permissions")
    app: Mapped[AppDefinition] = relationship(back_populates="user_permissions")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    app_key: Mapped[str] = mapped_column(ForeignKey("apps.key"), index=True, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    # queued | running | succeeded | failed
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # freeform JSON params (account number, bank, etc.)
    params: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # stored as RELATIVE paths under FILES_ROOT
    template_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    output_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    app: Mapped[AppDefinition] = relationship(back_populates="jobs")
    files: Mapped[list["JobFile"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class JobFile(Base):
    __tablename__ = "job_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id"), index=True, nullable=False)

    # input | template | output | other
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # stored as RELATIVE path under FILES_ROOT
    path: Mapped[str] = mapped_column(String(512), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    job: Mapped[Job] = relationship(back_populates="files")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)  # login | app_open
    username: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    app_key: Mapped[str | None] = mapped_column(String(64), nullable=True)  # only for app_open
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[str] = mapped_column(String(20), default="info", nullable=False)  # info | warning | success
    app_keys: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)  # [] = global
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class CatalogQuoteFolioCounter(Base):
    __tablename__ = "catalog_quote_folio_counters"

    serie: Mapped[str] = mapped_column(String(10), primary_key=True)
    last_folio: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
