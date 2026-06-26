import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { AccountsPage } from "./features/accounts/AccountsPage";
import { AccountDetailPage } from "./features/accounts/AccountDetailPage";
import UsersPage from "./features/admin/UsersPage";
import WebhooksAdminPage from "./features/admin/WebhooksAdminPage";
import RequestsPage from "./features/admin/RequestsPage";
import UserPortalPage from "./features/user/UserPortalPage";
import MyRequestsPage from "./features/user/MyRequestsPage";

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
  return (
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

        {/* User portal — all authenticated users */}
        <Route path="/my-loans" element={<UserPortalPage />} />
        <Route path="/my-requests" element={<MyRequestsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
