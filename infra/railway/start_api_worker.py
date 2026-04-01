from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path("/app")
API_DIR = ROOT / "apps" / "api"
WORKER_DIR = ROOT / "apps" / "worker"


def _spawn() -> tuple[subprocess.Popen[str], subprocess.Popen[str]]:
    worker = subprocess.Popen(
        [sys.executable, "worker.py"],
        cwd=str(WORKER_DIR),
    )
    api = subprocess.Popen(
        [
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            os.getenv("PORT", "8000"),
        ],
        cwd=str(API_DIR),
    )
    return worker, api


def _terminate(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()


def _kill(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.kill()


def main() -> int:
    worker, api = _spawn()
    children = [worker, api]

    def _handle_signal(signum, _frame):
        for child in children:
            _terminate(child)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        while True:
            for child in children:
                code = child.poll()
                if code is None:
                    continue

                for other in children:
                    if other is not child:
                        _terminate(other)
                time.sleep(3)
                for other in children:
                    if other is not child:
                        _kill(other)
                return code
            time.sleep(1)
    finally:
        for child in children:
            _terminate(child)


if __name__ == "__main__":
    raise SystemExit(main())
