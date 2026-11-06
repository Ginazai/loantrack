from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=255)
    role: Literal["admin", "user"] = "user"


class UserUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=255)
    password: str | None = Field(None, min_length=8)
    is_active: bool | None = None


class AdminUserUpdate(BaseModel):
    """Fields an admin may change on another user. All optional (partial update)."""

    model_config = {"extra": "forbid"}

    full_name: str | None = Field(None, min_length=1, max_length=255)
    email: EmailStr | None = None
    role: Literal["admin", "user"] | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    last_login: datetime | None
    created_at: datetime
