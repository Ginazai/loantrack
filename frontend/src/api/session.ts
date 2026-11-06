import { useAuthStore } from "../stores/authStore";
import { authApi } from "./index";
import { refreshSession } from "./client";

/**
 * Re-establish the session after a page load.
 *
 * Nothing sensitive is kept in browser storage: the access token lives in memory and the
 * refresh token is an httpOnly cookie that scripts cannot read. So on load the only way to
 * learn whether the visitor is still signed in is to ask the server to trade the cookie for a
 * fresh access token (and then fetch the profile). No cookie, or an expired one, is simply
 * "signed out", not an error.
 */
export async function restoreSession(): Promise<void> {
  const store = useAuthStore.getState();
  try {
    await refreshSession();
    store.setUser(await authApi.me());
  } catch {
    store.logout();
  }
}
