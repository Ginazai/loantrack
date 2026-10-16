import axios, { AxiosError } from "axios";
import { useAuthStore } from "../stores/authStore";

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

function isAuthEndpoint(url: string | undefined): boolean {
  return !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as any;

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
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
        refresh_token: store.refreshToken,
      });
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

export default client;