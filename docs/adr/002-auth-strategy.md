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

## Update (2026-11-01): refresh token moved to an httpOnly cookie
The *Decision* above (both tokens in `localStorage`) is **superseded**. The rationale that the cookie "adds complexity with the nginx proxy" turned out to be wrong: nginx forwards `Set-Cookie` and the cookie unchanged, and the SPA and API share an origin, so `SameSite=lax` needs no CORS change.

- The 7-day refresh token is an httpOnly, `Secure`, `SameSite=lax` cookie scoped to `/api/v1/auth`. Script (including an XSS payload) can no longer read it. The 15-minute access token is held in memory only; nothing auth-related is written to browser storage, and the old `auth` key is deleted on load.
- Because the cookie is sent automatically, `refresh`/`logout` require a custom `X-Requested-With` header (a cross-site page cannot add it without a CORS preflight) on top of `SameSite`.
- Refresh tokens now rotate within a *family* with reuse detection, are revoked when a user is deactivated or their password changes, and `logout` works from the cookie alone. Details: [architecture.md](../architecture.md#auth-and-permissions).
- Residual risk: an XSS can still *use* the session while the page is open (it can call the API with the in-memory token or trigger a refresh), it just can no longer steal a credential that outlives the tab. The CSP caveat above still applies.
- Split-origin deployments (SPA and API on different sites) need `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`; the CSRF header then becomes the main defence.
- Existing sessions end at deploy: browsers have no cookie yet, so everyone signs in once.
