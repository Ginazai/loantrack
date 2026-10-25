import axios, { AxiosError } from "axios";

/**
 * Cold-start handling for hosts that put idle services to sleep (Render's free
 * tier). While the backend wakes up, the proxy in front of it answers 502/503/504
 * (or sometimes 429) instead of holding the request. Without this, the first
 * page load after a quiet spell fails until someone opens the backend URL by hand.
 *
 * IMPORTANT: retrying through our own nginx proxy does NOT wake a sleeping Render service.
 * Render answers a request that comes from another Render service (our nginx -> backend)
 * with an instant 502 and never starts the target; only a request from outside Render, such
 * as the user's browser hitting the backend's public URL directly, does. So every retry here
 * is paired with a direct "wake ping" from the browser (see wakeBackend). See ADR-009.
 */

/**
 * Wait before retry N (1-based). Sums to ~2 minutes: Render needs about a minute to start a
 * free service, and our container runs migrations and the seed script before it listens.
 */
const RETRY_SCHEDULE_MS = [
  2000, 3000, 5000, 8000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000,
];
export const MAX_COLD_RETRIES = RETRY_SCHEDULE_MS.length;

/** Longest pause a server-sent Retry-After may impose, so a bad header can't stall the UI. */
const MAX_RETRY_AFTER_MS = 15000;

const GATEWAY_STATUSES = new Set([502, 503, 504]);
const READ_ONLY_METHODS = new Set(["get", "head", "options"]);

export function retryDelayMs(attempt: number, retryAfter?: string | number | null): number {
  const base = RETRY_SCHEDULE_MS[Math.min(Math.max(attempt, 1), MAX_COLD_RETRIES) - 1];
  const seconds = Number(retryAfter);
  if (retryAfter == null || !Number.isFinite(seconds) || seconds <= 0) return base;
  return Math.max(base, Math.min(seconds * 1000, MAX_RETRY_AFTER_MS));
}

/** 429 produced by this app's own limiter (slowapi: {"error": "Rate limit exceeded: ..."}). */
function isAppRateLimit(error: AxiosError): boolean {
  const body = error.response?.data as { error?: unknown } | undefined;
  return typeof body?.error === "string" && body.error.startsWith("Rate limit exceeded");
}

/**
 * Should this failed request be retried because the backend may be waking up?
 *
 * - Gateway errors (502/503/504), a 429 that did NOT come from our own limiter,
 *   and "no response at all" (network error) count as cold-start symptoms.
 * - Read-only requests and login/refresh are always safe to resend.
 * - Anything else (e.g. POST /payments) is resent only on 503 or a proxy 429,
 *   where the request is known not to have been processed. A 502/504 or dropped
 *   connection could mean it was, and resending could double-record a payment.
 */
export function shouldRetryColdStart(
  error: unknown,
  retriesSoFar: number,
  isAuthEndpoint = false,
): boolean {
  if (retriesSoFar >= MAX_COLD_RETRIES || !axios.isAxiosError(error)) return false;

  const status = error.response?.status;
  let symptom: boolean;
  let provablyUnprocessed: boolean;

  if (status === undefined) {
    symptom = error.code === "ERR_NETWORK" || error.code === "ECONNABORTED";
    provablyUnprocessed = false;
  } else if (status === 429) {
    symptom = !isAppRateLimit(error);
    provablyUnprocessed = symptom;
  } else {
    symptom = GATEWAY_STATUSES.has(status);
    provablyUnprocessed = status === 503;
  }
  if (!symptom) return false;

  const method = (error.config?.method ?? "get").toLowerCase();
  return READ_ONLY_METHODS.has(method) || isAuthEndpoint || provablyUnprocessed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let backendUrl: Promise<string | null> | null = null;

/**
 * The backend's public URL, as configured for the frontend container (nginx serves it at
 * /runtime-config.json from BACKEND_URL). Null when it isn't published, e.g. local docker
 * compose, where the backend never sleeps and nothing needs waking.
 */
export function resolveBackendUrl(): Promise<string | null> {
  if (!backendUrl) {
    backendUrl = fetch("/runtime-config.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { backendUrl?: unknown } | null) => {
        const url = typeof cfg?.backendUrl === "string" ? cfg.backendUrl.trim() : "";
        return /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : null;
      })
      .catch(() => null)
      .then((url) => {
        if (!url) backendUrl = null; // don't cache a miss: try again next time
        return url;
      });
  }
  return backendUrl;
}

let wakeInFlight: Promise<void> | null = null;

/**
 * Hit the backend's public URL straight from the browser so Render starts it.
 * `no-cors` + no credentials: we only need the request to arrive, not to read the answer
 * (Render may reply with its own "waking up" page, which is fine). Never throws; at most one
 * ping is in flight at a time so a slow wake can't pile up requests.
 */
export function wakeBackend(): Promise<void> {
  if (wakeInFlight) return wakeInFlight;
  wakeInFlight = resolveBackendUrl()
    .then(async (base) => {
      if (!base) return;
      await fetch(`${base}/api/v1/health`, {
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
      });
    })
    .catch(() => undefined)
    .finally(() => {
      wakeInFlight = null;
    });
  return wakeInFlight;
}

/** Test hook: forget the cached backend URL and any in-flight wake ping. */
export function resetWakeStateForTests(): void {
  backendUrl = null;
  wakeInFlight = null;
}
