# ── Stage 1: dependency resolution ───────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Create a virtual environment and install runtime dependencies
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN python -m pip install --upgrade pip setuptools wheel poetry-core

# Copy project files for building
COPY pyproject.toml ./
COPY alembic/ ./alembic/
COPY app/ ./app/

# Install production dependencies into /app/.venv
RUN pip install --no-cache-dir .

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app

# Copy the pre-built venv from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application source
COPY --chown=app:app . .

# Make the venv the active Python environment
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Entrypoint: run migrations then start the server
COPY --chown=app:app entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER app

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/api/v1/health').raise_for_status()"

ENTRYPOINT ["/entrypoint.sh"]
