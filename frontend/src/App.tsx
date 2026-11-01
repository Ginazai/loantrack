import { InlineLoading } from "@carbon/react";
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { restoreSession } from "./api/session";
import { useAuthStore } from "./stores/authStore";
import { ServerWakingNotice } from "./components/feedback";
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const status = useAuthStore((s) => s.status);
  if (isAuthenticated) return <>{children}</>;
  // The access token lives only in memory, so right after a page load we cannot tell
  // "signed out" from "signed in, token not fetched yet". Wait for the answer rather than
  // bouncing a signed-in user to /login on every refresh.
  if (status === "unknown") {
    return (
      <div className="lt-page" role="status">
        <InlineLoading description="Restoring your session…" />
      </div>
    );
  }
  return <Navigate to="/login" replace />;
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
  useEffect(() => {
    // Once per page load: trade the httpOnly refresh cookie (if any) for an access token.
    if (useAuthStore.getState().status === "unknown") void restoreSession();
  }, []);

  return (
    <>
      <ServerWakingNotice />
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
    </>
  );
}
