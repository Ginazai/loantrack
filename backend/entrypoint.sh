#!/bin/sh
set -eu

echo "Running database migrations..."
/app/.venv/bin/alembic upgrade head

echo "🚀 Starting server..."
LOG_LEVEL_LOWER=$(printf '%s' "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')

exec /app/.venv/bin/python -m uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers "${UVICORN_WORKERS:-2}" \
    --log-level "$LOG_LEVEL_LOWER"
