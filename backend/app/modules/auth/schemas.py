from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Only the short-lived access token travels in the body.

    The refresh token is set as an httpOnly cookie and never appears in a response body, so
    page JavaScript (and therefore an XSS payload) cannot read it.
    """

    access_token: str
    token_type: str = "bearer"
