FROM python:3.11-slim

WORKDIR /worker
COPY apps/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/worker/processors/ processors/
COPY apps/worker/tests/ tests/
COPY apps/worker/cfe_lib/ cfe_lib/
COPY apps/worker/templates/ templates/
COPY apps/worker/worker.py .

# Shared services from the API app (used by treasury worker)
COPY apps/api/app/services/ services/

ENV PYTHONUNBUFFERED=1
CMD ["python", "worker.py"]
