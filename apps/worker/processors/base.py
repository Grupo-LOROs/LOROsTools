"""
Base types and helpers shared by all processors.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional


@dataclass
class JobContext:
    """Everything a processor needs to do its work."""

    job_id: uuid.UUID
    app_key: str
    params: dict

    # Absolute paths
    files_root: Path          # e.g. /data/files
    inputs_dir: Path          # e.g. /data/files/jobs/<id>/inputs
    output_dir: Path          # e.g. /data/files/jobs/<id>/output
    template_abs: Optional[Path]  # e.g. /data/files/jobs/<id>/template/plantilla.xlsx

    # Callback to report progress — worker injects this
    # signature: report_progress(percent: int, message: str)
    report_progress: Callable[[int, str], None] = field(default=lambda p, m: None)

    # ── helpers ──────────────────────────────────────────────

    def input_files(self, ext: str | None = None) -> list[Path]:
        """List input files, optionally filtered by extension (e.g. '.pdf')."""
        if not self.inputs_dir.exists():
            return []
        files = sorted(self.inputs_dir.iterdir())
        if ext:
            ext = ext.lower() if ext.startswith(".") else f".{ext.lower()}"
            files = [f for f in files if f.suffix.lower() == ext]
        return files

    def output_path(self, filename: str = "output.xlsx") -> Path:
        """Return absolute path for an output file, creating the dir."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        return self.output_dir / filename

    def output_rel(self, filename: str = "output.xlsx") -> str:
        """Return relative path (for storing in DB)."""
        return f"jobs/{self.job_id}/output/{filename}"


def make_output_dir(ctx: JobContext) -> Path:
    """Ensure output directory exists and return it."""
    ctx.output_dir.mkdir(parents=True, exist_ok=True)
    return ctx.output_dir
