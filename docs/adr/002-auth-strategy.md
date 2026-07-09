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
