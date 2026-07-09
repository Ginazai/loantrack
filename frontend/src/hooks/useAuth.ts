import { useAuthStore } from "../stores/authStore";
/** Typed shortcut for auth state + role checks. */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)();
  return { user, isAuthenticated, isAdmin: user?.role === "admin" };
}
