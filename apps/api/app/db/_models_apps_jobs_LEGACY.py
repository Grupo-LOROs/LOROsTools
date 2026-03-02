from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.session import Base


class AppDefinition(Base):
    __tablename__ = "apps"

    key = Column(String(80), primary_key=True)  # slug fijo
    unit = Column(String(50), nullable=False)   # tesoreria / gi / era_ventas ...
    name = Column(String(120), nullable=False)
    mode = Column(String(20), nullable=False)   # batch | interactive
    description = Column(Text, nullable=True)

    # inputs/output en JSON para que el portal renderice forms sin hardcode
    inputs = Column(JSONB, nullable=False, default=list)   # [{type, multiple, required, role?}]
    output = Column(JSONB, nullable=False, default=dict)   # {type:"xlsx"}

    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Job(Base):
    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    app_key = Column(String(80), ForeignKey("apps.key"), nullable=False)
    status = Column(String(20), nullable=False, default="queued")  # queued|running|succeeded|failed

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    # para debugging / UI
    error = Column(Text, nullable=True)

    # paths locales
    input_dir = Column(String(500), nullable=False)
    output_file = Column(String(500), nullable=True)

    # metadata útil
    input_manifest = Column(JSONB, nullable=False, default=dict)

    app = relationship("AppDefinition")
    files = relationship("JobFile", back_populates="job", cascade="all,delete-orphan")


class JobFile(Base):
    __tablename__ = "job_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False)

    role = Column(String(50), nullable=False, default="file")  # file | template | etc.
    filename = Column(String(300), nullable=False)
    content_type = Column(String(120), nullable=True)
    size_bytes = Column(Integer, nullable=True)

    stored_path = Column(String(700), nullable=False)

    job = relationship("Job", back_populates="files")
