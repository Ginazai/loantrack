#!/bin/sh
set -eu

echo "Running database migrations..."
/app/.venv/bin/alembic upgrade head

echo "Seeding initial data..."
python /app/seed.py

echo "🚀 Starting server..."

LOG_LEVEL_LOWER=$(echo "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')

# --no-proxy-headers: uvicorn's own X-Forwarded-For handling is switched off on purpose.
# The app resolves the client address itself (app/core/client_ip.py), honouring the header
# only from TRUSTED_PROXIES. Leaving uvicorn's on would give a second, different trust rule
# (FORWARDED_ALLOW_IPS=* believes whatever the client wrote).
exec /app/.venv/bin/python -m uvicorn app.main:app \
    --no-proxy-headers \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "${UVICORN_WORKERS:-2}" \
    --log-level "$LOG_LEVEL_LOWER"
