# ADR-002: Authentication Strategy

**Status:** Accepted  
**Date:** 2026-06-15

## Context
Internal tool — small set of known users. No SSO requirement.

## Decision
JWT with short-lived access tokens (15 min) + long-lived refresh tokens (7 days) stored in `localStorage` (acceptable for internal use). Passwords hashed with bcrypt.

## Rationale
HttpOnly cookies require CORS + sameSite configuration that adds complexity with the nginx proxy. For an internal tool where XSS risk is low and users are trusted, localStorage is an acceptable trade-off.

## Consequences
- XSS risk: mitigated by CSP headers and no dynamic HTML rendering.
- Token refresh handled client-side by Axios interceptor on 401.
- If SSO needed later: swap auth module; JWT shape stays the same.

## Update (2026-10-24)
Checked against the code; the decision stands but two statements in *Consequences* need qualifying:
- **CSP covers API responses only.** The `Content-Security-Policy` header is added by FastAPI middleware (`main.py`). The nginx container that serves the SPA sets none, and the policy allows `'unsafe-inline'` scripts. The XSS mitigation is therefore weaker than written. The "no dynamic HTML rendering" part was not audited.
- Refresh tokens are stored hashed in the database and `POST /auth/logout` revokes all of a user's refresh tokens. See [architecture.md](../architecture.md#auth-and-permissions) for the current endpoint behaviour, including that `POST /auth/register` is now admin-only (it was public and accepted a `role` until 2026-10-24).
