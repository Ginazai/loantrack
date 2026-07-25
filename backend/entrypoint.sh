#!/bin/sh
set -e

echo "Running database migrations..."
/app/.venv/bin/alembic upgrade head

echo "🚀 Starting server..."
# uvicorn requires lowercase log level; $(echo ... | tr ...) normalises whatever LOG_LEVEL is set to
LOG_LEVEL_LOWER=$(echo "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')

exec python -m uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers "${UVICORN_WORKERS:-2}" \
    --log-level "$LOG_LEVEL_LOWER"
