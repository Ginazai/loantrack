import { create } from "zustand";
import type { User } from "../types";

/**
 * Where the session stands. "unknown" only exists between page load and the first answer from
 * the server: the refresh token lives in an httpOnly cookie that scripts cannot see, so the
 * only way to learn whether a session exists is to ask (see api/session.ts).
 */
export type SessionStatus = "unknown" | "authenticated" | "anonymous";

interface AuthState {
  /** Short-lived access token. In memory only: never written to localStorage/sessionStorage. */
  accessToken: string | null;
  user: User | null;
  status: SessionStatus;
  setAccessToken: (access: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

// Earlier versions persisted both tokens under this key. Remove them so a long-lived refresh
// token from before the move to httpOnly cookies does not sit in browser storage forever.
const LEGACY_STORAGE_KEY = "auth";
try {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch {
  /* storage unavailable (private mode, SSR, tests): nothing to clean */
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  accessToken: null,
  user: null,
  status: "unknown",

  setAccessToken: (access) => set({ accessToken: access, status: "authenticated" }),

  setUser: (user) => set({ user }),

  logout: () => set({ accessToken: null, user: null, status: "anonymous" }),

  isAuthenticated: () => !!get().accessToken,
}));
