import axios, { AxiosError } from "axios";

/**
 * Cold-start handling for hosts that put idle services to sleep (Render's free
 * tier). While the backend wakes up, the proxy in front of it answers 502/503/504
 * (or sometimes 429) instead of holding the request. Without this, the first
 * page load after a quiet spell fails until someone opens the backend URL by hand.
 *
 * Pure functions only; the retry loop itself lives in client.ts.
 */

/** Wait before retry N (1-based). Sums to ~58 s, in the range of a Render cold start. */
const RETRY_SCHEDULE_MS = [2000, 3000, 5000, 8000, 10000, 10000, 10000, 10000];
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
