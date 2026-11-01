from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


def _password_fits_bcrypt(v: str | None) -> str | None:
    # bcrypt only reads the first 72 bytes. Rather than silently ignore the rest (two
    # different long passwords would then be "the same"), refuse what it cannot honour.
    if v is not None and len(v.encode()) > 72:
        raise ValueError("Password must be at most 72 bytes")
    return v


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=255)
    role: Literal["admin", "user"] = "user"

    _password_len = field_validator("password")(_password_fits_bcrypt)


class SelfUpdate(BaseModel):
    """What a signed-in user may change about THEMSELVES (PATCH /auth/me).

    A closed schema on purpose: this endpoint used to take a raw dict, so any new column on
    the user model was one careless line away from being self-editable. Role, email and
    is_active are not here and, with ``extra="forbid"``, sending them is a 422, not a no-op.
    """

    model_config = {"extra": "forbid"}

    full_name: str | None = Field(None, min_length=1, max_length=255)
    # Changing the password requires proving you know the current one: a stolen access
    # token must not be enough to lock the real owner out.
    current_password: str | None = Field(None, max_length=1024)
    new_password: str | None = Field(None, min_length=8)

    _password_len = field_validator("new_password")(_password_fits_bcrypt)

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("full_name must not be blank")
        return v

    @model_validator(mode="after")
    def _new_password_needs_current(self) -> "SelfUpdate":
        if self.new_password is not None and not self.current_password:
            raise ValueError("current_password is required to set a new password")
        return self


class AdminUserUpdate(BaseModel):
    """Fields an admin may change on another user. All optional (partial update)."""

    model_config = {"extra": "forbid"}

    full_name: str | None = Field(None, min_length=1, max_length=255)
    email: EmailStr | None = None
    role: Literal["admin", "user"] | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)

    _password_len = field_validator("password")(_password_fits_bcrypt)


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    last_login: datetime | None
    created_at: datetime
