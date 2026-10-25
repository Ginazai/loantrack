import axios, { AxiosError } from "axios";
import { useAuthStore } from "../stores/authStore";
import { useConnectionStore } from "../stores/connectionStore";
import {
  MAX_COLD_RETRIES,
  retryDelayMs,
  shouldRetryColdStart,
  sleep,
  wakeBackend,
} from "./coldStart";

// VITE_API_BASE_URL is baked in at build time by Vite.
// Falls back to relative path for local dev (docker-compose nginx proxy).
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

const client = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Inject access token on every request
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
let refreshing = false;
let queue: Array<(token: string) => void> = [];

// A 401 from these endpoints is an expected, user-facing outcome (wrong
// credentials, invalid/expired refresh token) — NOT a signal that a valid
// session's access token just expired. Letting the retry-refresh logic
// below run for these anyway was the root cause of a real bug: a wrong
// password on /auth/login returned 401 -> this interceptor tried to
// refresh using a refresh_token that doesn't exist yet (never logged in)
// -> that refresh call *also* 401'd -> its catch block hard-redirected to
// /login via `window.location.href`. That full-page navigation happened
// before LoginPage's own `catch` block could call `setError(...)`, and
// since we were already on /login, it looked exactly like "the page just
// reloaded and swallowed the error" instead of showing one.
const AUTH_ENDPOINTS = ["/auth/login", "/auth/refresh"];

// Exported so the exact logic of the bug fix can be unit-tested directly
// (see client.test.ts) without needing to drive the whole axios pipeline.
export function isAuthEndpoint(url: string | undefined): boolean {
  return !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

function clearWaking() {
  if (useConnectionStore.getState().waking) useConnectionStore.getState().setWaking(false);
}

/**
 * POST /auth/refresh with the same cold-start patience as every other request.
 * It uses bare axios (to bypass the interceptors below), so it needs its own loop;
 * otherwise a 502 while the backend wakes would be treated as "session expired"
 * and log the user out.
 */
async function refreshWithColdStartRetry(refreshToken: string | null) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refreshToken });
    } catch (e) {
      if (!shouldRetryColdStart(e, attempt - 1, true)) {
        clearWaking();
        throw e;
      }
      useConnectionStore.getState().setWaking(true);
      void wakeBackend();
      await sleep(retryDelayMs(attempt, (e as AxiosError).response?.headers?.["retry-after"]));
    }
  }
}

client.interceptors.response.use(
  (res) => {
    clearWaking();
    return res;
  },
  async (error: AxiosError) => {
    const original = error.config as any;

    // Backend asleep / waking (502/503/504, proxy 429, network error): wait and resend
    // instead of failing, and tell the user why it is slow.
    if (original) {
      const retries: number = original._coldRetries ?? 0;
      if (shouldRetryColdStart(error, retries, isAuthEndpoint(original.url))) {
        original._coldRetries = retries + 1;
        useConnectionStore.getState().setWaking(true);
        void wakeBackend(); // the proxied retry below can't wake it; only a direct hit does
        await sleep(retryDelayMs(retries + 1, error.response?.headers?.["retry-after"]));
        return client(original);
      }
      if (retries >= MAX_COLD_RETRIES) clearWaking(); // gave up: let the real error surface
    }

    if (
      error.response?.status !== 401 ||
      original._retry ||
      isAuthEndpoint(original?.url)
    ) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (refreshing) {
      return new Promise((resolve) => {
        queue.push((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          resolve(client(original));
        });
      });
    }

    refreshing = true;
    const store = useAuthStore.getState();

    try {
      const { data } = await refreshWithColdStartRetry(store.refreshToken);
      store.setTokens(data.access_token, data.refresh_token);
      queue.forEach((cb) => cb(data.access_token));
      queue = [];
      original.headers.Authorization = `Bearer ${data.access_token}`;
      return client(original);
    } catch {
      store.logout();
      window.location.href = "/login";
      return Promise.reject(error);
    } finally {
      refreshing = false;
    }
  }
);

/**
 * Starts waking a sleeping backend as soon as the app loads (the login page appears
 * instantly, but the API behind it may not be up yet). The direct ping is what actually
 * wakes it; the proxied /health request then waits for it, via the retry loop above.
 * Nothing is surfaced to the user here.
 */
export function warmUpBackend(): void {
  void wakeBackend();
  client.get("/health").catch(() => undefined);
}

export default client;
