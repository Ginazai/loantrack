import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

from app.core.config import get_settings

settings = get_settings()

# ── Password ──────────────────────────────────────────────────────────────────


# bcrypt used directly: passlib 1.7.4 is unmaintained and breaks on bcrypt >= 4.1 (its
# startup self-test hashes a >72-byte secret, which bcrypt 5 rejects). bcrypt only reads the
# first 72 bytes, and 5.x raises instead of truncating, so truncate to keep old behaviour.
def _b(plain: str) -> bytes:
    return plain.encode()[:72]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_b(plain), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(_b(plain), hashed.encode())


# ── JWT ───────────────────────────────────────────────────────────────────────


def create_access_token(subject: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "role": role, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(subject: str) -> tuple[str, datetime]:
    """Returns (raw_token, expires_at). Store hash(raw_token) in DB."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    raw = str(uuid.uuid4())
    payload = {"sub": subject, "jti": raw, "exp": expire, "type": "refresh"}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, expire


def decode_token(token: str) -> dict:
    """Raises JWTError on invalid/expired tokens."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def hash_token(token: str) -> str:
    """SHA-256 hash for storing refresh tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


# ── Webhook HMAC ──────────────────────────────────────────────────────────────


def sign_webhook_payload(payload: dict, secret: str) -> str:
    """HMAC-SHA256 signature for outgoing webhook payloads."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def generate_webhook_secret() -> str:
    return hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()
