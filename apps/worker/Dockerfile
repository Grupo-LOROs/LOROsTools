FROM python:3.11-slim

WORKDIR /worker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY processors/ processors/
COPY tests/ tests/
COPY cfe_lib/ cfe_lib/
COPY templates/ templates/
COPY worker.py .

ENV PYTHONUNBUFFERED=1
CMD ["python", "worker.py"]
