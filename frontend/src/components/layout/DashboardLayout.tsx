import {
  ChevronLeft, ChevronRight, ClipboardList, FileText, LayoutDashboard,
  LogOut, Moon, Settings, Sun, Users, Wallet, Webhook,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authApi } from "../../api";
import { AccountSettingsModal } from "../../features/profile/AccountSettingsModal";
import { useAuthStore } from "../../stores/authStore";
import { useUIStore } from "../../stores/uiStore";

export function DashboardLayout() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, sidebarOpen, setSidebarOpen } = useUIStore();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const isAdmin = user?.role === "admin";

  const handleLogout = async () => {
    await authApi.logout().catch(() => {});
    logout();
    navigate("/login");
  };

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `sidebar-active-indicator flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? "bg-primary/10 text-primary font-semibold"
        : "hover:bg-white/5 text-neutral-content/70 hover:text-neutral-content"
    }`;

  return (
    <div className="flex h-screen overflow-hidden bg-base-200">
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className={`flex flex-col bg-neutral shadow-xl transition-all duration-300 ${sidebarOpen ? "w-60" : "w-14"}`}>
        {/* Logo */}
        <div className={`flex items-center gap-3 border-b border-white/5 ${sidebarOpen ? "px-4 py-5" : "px-3 py-5 justify-center"}`}>
          <div className="flex-shrink-0 w-8 h-8 bg-primary rounded-md flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          {sidebarOpen && (
            <div>
              <span className="font-bold text-base text-white tracking-tight">LoanTrack</span>
              <p className="text-xs text-white/30 font-mono tracking-wider">LEDGER</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
          {isAdmin ? (
            <>
              <NavLink to="/dashboard" className={navCls}>
                <LayoutDashboard className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>Dashboard</span>}
              </NavLink>
              <NavLink to="/accounts" className={navCls}>
                <ClipboardList className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>Accounts</span>}
              </NavLink>

              {sidebarOpen
                ? <p className="px-3 pt-5 pb-1 text-xs font-semibold text-neutral-content/30 uppercase tracking-widest">Administration</p>
                : <div className="my-2 mx-3 border-t border-white/5" />}

              <NavLink to="/admin/users" className={navCls}>
                <Users className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>Users</span>}
              </NavLink>
              <NavLink to="/admin/requests" className={navCls}>
                <FileText className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>Requests</span>}
              </NavLink>
              <NavLink to="/admin/webhooks" className={navCls}>
                <Webhook className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>Webhooks</span>}
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/my-loans" className={navCls}>
                <LayoutDashboard className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>My Loans</span>}
              </NavLink>
              <NavLink to="/my-requests" className={navCls}>
                <FileText className={`flex-shrink-0 text-neutral-content/50 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                {sidebarOpen && <span>My Requests</span>}
              </NavLink>
            </>
          )}
        </nav>

        {/* Profile — pinned to bottom of sidebar */}
        <div className="border-t border-white/5 p-2">
          <div className="dropdown dropdown-top dropdown-end w-full">
            <div
              tabIndex={0}
              role="button"
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-md cursor-pointer hover:bg-white/5 transition-colors ${!sidebarOpen ? "justify-center" : ""}`}
            >
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-white">{user?.full_name?.[0]?.toUpperCase()}</span>
              </div>
              {sidebarOpen && (
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-content leading-tight truncate">{user?.full_name}</p>
                  <p className="text-xs text-neutral-content/40 font-mono uppercase tracking-wide">{user?.role}</p>
                </div>
              )}
            </div>

            <ul
              tabIndex={0}
              className="dropdown-content z-50 menu menu-sm bg-base-100 rounded-box shadow-xl border border-base-300 w-52 mb-2 p-1.5"
            >
              <li className="px-3 py-2 pointer-events-none">
                <div>
                  <p className="text-xs font-semibold text-base-content truncate">{user?.full_name}</p>
                  <p className="text-xs text-base-content/40 font-mono truncate">{user?.email}</p>
                </div>
              </li>
              <div className="divider my-0.5" />
              <li>
                <button className="flex items-center gap-2.5 text-sm" onClick={() => setShowSettings(true)}>
                  <Settings className="w-4 h-4 text-base-content/50" />
                  Account Settings
                </button>
              </li>
              <li>
                <button className="flex items-center gap-2.5 text-sm text-error" onClick={handleLogout}>
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </li>
            </ul>
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-base-100 border-b border-base-300 px-4 py-2.5 flex items-center justify-between shadow-sm">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="btn btn-ghost btn-sm btn-square">
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button
            onClick={toggleTheme}
            className="btn btn-ghost btn-sm btn-square"
            title={theme === "ledger" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "ledger"
              ? <Moon className="w-4 h-4 text-base-content/60" />
              : <Sun className="w-4 h-4 text-base-content/60" />}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
