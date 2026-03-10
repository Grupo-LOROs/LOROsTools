from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class CatalogBase(DeclarativeBase):
    pass


def make_catalog_engine(db_path: Path):
    return create_engine(
        f"sqlite:///{db_path.as_posix()}",
        future=True,
        connect_args={"check_same_thread": False},
    )


def make_catalog_session_factory(db_path: Path):
    engine = make_catalog_engine(db_path)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
