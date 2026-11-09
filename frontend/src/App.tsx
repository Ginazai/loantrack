import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { restoreSession } from "./api/session";
import { ServerWakingNotice, SessionLoading } from "./components/feedback";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { AccountsPage } from "./features/accounts/AccountsPage";
import { AccountDetailPage } from "./features/accounts/AccountDetailPage";
import UsersPage from "./features/admin/UsersPage";
import WebhooksAdminPage from "./features/admin/WebhooksAdminPage";
import RequestsPage from "./features/admin/RequestsPage";
import ImportsPage from "./features/admin/ImportsPage";
import UserPortalPage from "./features/user/UserPortalPage";
import MyRequestsPage from "./features/user/MyRequestsPage";

/**
 * On a page load the access token is gone (it lives in memory only) but the httpOnly refresh
 * cookie may still be good, and only the server can say. So no route is mounted until the
 * restore has fully settled: token AND profile, or a definite "no session". Deciding earlier
 * would send a signed-in user to /login, or an admin to /my-loans while the profile loads.
 */
function useSessionRestored(): boolean {
  const [done, setDone] = useState(() => {
    const { status, accessToken } = useAuthStore.getState();
    return status !== "unknown" || !!accessToken;
  });

  useEffect(() => {
    if (done) return;
    let live = true;
    void restoreSession().finally(() => {
      if (live) setDone(true);
    });
    return () => {
      live = false;
    };
  }, [done]);

  return done;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  return user?.role === "admin" ? <>{children}</> : <Navigate to="/my-loans" replace />;
}

function RootRedirect() {
  const user = useAuthStore((s) => s.user);
  return <Navigate to={user?.role === "admin" ? "/dashboard" : "/my-loans"} replace />;
}

export default function App() {
  const restored = useSessionRestored();
  return (
    <>
      <ServerWakingNotice />
      {!restored ? (
        <SessionLoading />
      ) : (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><RootRedirect /></RequireAuth>} />

        <Route element={<RequireAuth><DashboardLayout /></RequireAuth>}>
          {/* Admin */}
          <Route path="/dashboard" element={<RequireAdmin><DashboardPage /></RequireAdmin>} />
          <Route path="/accounts" element={<RequireAdmin><AccountsPage /></RequireAdmin>} />
          <Route path="/accounts/:id" element={<RequireAdmin><AccountDetailPage /></RequireAdmin>} />
          <Route path="/admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
          <Route path="/admin/requests" element={<RequireAdmin><RequestsPage /></RequireAdmin>} />
          <Route path="/admin/webhooks" element={<RequireAdmin><WebhooksAdminPage /></RequireAdmin>} />
          <Route path="/admin/imports" element={<RequireAdmin><ImportsPage /></RequireAdmin>} />

          {/* User portal — all authenticated users */}
          <Route path="/my-loans" element={<UserPortalPage />} />
          <Route path="/my-requests" element={<MyRequestsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      )}
    </>
  );
}
