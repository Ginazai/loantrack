# ADR-009: Wake a sleeping Render backend from the browser, and retry while it boots

**Status:** Accepted  
**Date:** 2026-10-24 (revised the same day, see *Revision* at the end)

## Context
The app runs on Render, where idle free services are put to sleep and the next request starts them. After a quiet spell the SPA failed with 502 or 429 until someone opened the backend's URL in a browser and reloaded.

The frontend reaches the backend through nginx in the frontend service (`/api/` is proxied to `BACKEND_URL`). Community reports of the free tier, consistent with what was observed here, say that a request **from one Render service to a sleeping free service gets an instant 502 from Render's proxy and does not start it**; requests from outside Render do start it. This is not stated in Render's own documentation and we have not reproduced it against Render ourselves. It explains why the manual workaround (opening the backend URL in a browser) works while the app's own traffic never does.

The container also runs migrations and the seed script before listening, so a cold start is longer than the platform's roughly one minute.

## Decision
The wake-up request must originate outside Render, and the app must then wait for the backend to finish booting.

1. **Publish the backend's public URL to the browser.** nginx serves `/runtime-config.json` (`{"backendUrl": "<BACKEND_URL>"}`) from the same `BACKEND_URL` it proxies to.
2. **Direct wake ping.** On page load and before every retry the SPA sends a `no-cors`, credential-less `GET <backendUrl>/api/v1/health` straight to the backend. The response is not read. One ping in flight at a time.
3. **Retry through the proxy** for cold-start symptoms (502/503/504, a 429 that is not this API's own limiter, network errors): up to 14 retries over about two minutes, honouring `Retry-After`, then surface the real error. A banner ("Connecting to the server") explains the wait.
4. **Retry only what is safe.** Reads and login/refresh are always resent. Other writes are resent only after 503 or a proxy 429 (known not processed). After 502/504 or a dropped connection they are not resent, because the first attempt may have been recorded, and a duplicate payment is worse than asking the user to retry.
5. **The API's own 429 is not retried**, so a real lock-out is shown at once.
6. **Token refresh gets the same wake-and-retry**, so a 502 during refresh cannot be mistaken for an expired session and log the user out.
7. **nginx waits up to 120 s** for the backend (`proxy_connect/send/read_timeout`) instead of its 60 s default.
8. **Optional keep-alive** (`keep-alive.yml`): a scheduled ping from GitHub (outside Render, so it does wake the service), disabled until the `KEEP_ALIVE_URL` variable is set.

## Consequences
- `BACKEND_URL` on the frontend service must be the backend's public `https://` URL. An internal address cannot be pinged by the browser.
- If the browser cannot reach the backend URL (network policy, blocker extension), nothing wakes it and requests fail after about two minutes.
- After a quiet spell the first request takes about as long as a cold start but succeeds without manual intervention.
- A user who is actually offline sees the "Connecting" banner for about two minutes before an error appears, because "no response" can't be told apart from a sleeping backend.
- A payment submitted while the backend was asleep and rejected with 502 needs a manual retry.
- Backend background loops (webhook retry, cycle-close scan) are in-process ([ADR-006](006-cycle-close-detection-without-worker.md)) and do not run while the service sleeps; only keeping the service awake addresses that.
- The keep-alive workflow trades free-tier instance hours for responsiveness and depends on GitHub's best-effort cron.
- The platform behaviour in *Context* is an assumption from reports. If Render changes it, the extra ping is harmless.

## Alternatives considered
- **Paid always-on instance:** the reliable fix, with a monthly cost. Compatible with this ADR; the client logic then never triggers.
- **Run frontend and backend as one Render service**, so a visit to the site is itself outside traffic for the backend. Removes the cross-service hop, but is a larger restructuring (one container serving both).
- **Redirect the browser through nginx** (`/wake` returning a redirect to the backend) instead of a config file: needs CORS to succeed cleanly and gives the SPA less control over timing.
- **Keep-alive only:** cron can be late or disabled, so a cold start would still break the app occasionally.
- **Retry everything including all POSTs:** simpler, but risks double-recording payments after a 502/504.

## Revision
The first version of this ADR (and its implementation) assumed the backend would wake as soon as nginx's retried request reached Render, so it only added retries, a banner and longer nginx timeouts. That was wrong: the banner appeared but the backend stayed asleep, because requests from nginx never start it. The direct browser wake ping (decisions 1 and 2) is the correction, and the tests now model a platform that only wakes for direct requests.
