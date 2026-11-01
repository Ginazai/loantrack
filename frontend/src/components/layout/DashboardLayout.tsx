import {
  Asleep,
  Dashboard,
  DocumentAdd,
  DocumentImport,
  Light,
  Logout,
  Money,
  Settings,
  UserAvatar,
  UserMultiple,
  Webhook,
} from "@carbon/icons-react";
import {
  Button,
  Content,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  HeaderPanel,
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SkipToContent,
  Tag,
  Theme,
} from "@carbon/react";
import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../../api";
import { AccountSettingsModal } from "../../features/profile/AccountSettingsModal";
import { useAuthStore } from "../../stores/authStore";
import { useUIStore } from "../../stores/uiStore";

interface NavEntry {
  to: string;
  label: string;
  Icon: ComponentType<any>;
}

const ADMIN_PRIMARY: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", Icon: Dashboard },
  { to: "/accounts", label: "Accounts", Icon: Money },
];

const ADMIN_SECONDARY: NavEntry[] = [
  { to: "/admin/users", label: "Users", Icon: UserMultiple },
  { to: "/admin/requests", label: "Requests", Icon: DocumentAdd },
  { to: "/admin/webhooks", label: "Webhooks", Icon: Webhook },
  { to: "/admin/imports", label: "Imports", Icon: DocumentImport },
];

const USER_NAV: NavEntry[] = [
  { to: "/my-loans", label: "My Loans", Icon: Dashboard },
  { to: "/my-requests", label: "My Requests", Icon: DocumentAdd },
];

/** True from Carbon's `lg` breakpoint (1056px) up, where the nav can be a persistent rail. */
function useIsDesktop() {
  const query = "(min-width: 66rem)";
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return matches;
}

export function DashboardLayout() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, sidebarOpen, setSidebarOpen } = useUIStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelWrapRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === "admin";
  const isDesktop = useIsDesktop();

  const handleLogout = async () => {
    await authApi.logout().catch(() => {});
    logout();
    navigate("/login");
  };

  // Close the user panel on outside click or Escape.
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!panelWrapRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanelOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelOpen]);

  const closeNavIfOverlay = () => {
    // Below Carbon's `lg` breakpoint the nav is an overlay; dismiss it after navigating.
    if (!window.matchMedia("(min-width: 66rem)").matches) setSidebarOpen(false);
  };

  const renderLink = ({ to, label, Icon }: NavEntry) => {
    const active = pathname === to || pathname.startsWith(`${to}/`);
    return (
      <SideNavLink
        key={to}
        as={Link}
        to={to}
        renderIcon={Icon}
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={closeNavIfOverlay}
      >
        {label}
      </SideNavLink>
    );
  };

  return (
    <>
      <Theme theme="g100">
        <Header aria-label="LoanTrack">
          <SkipToContent href="#main-content" />
          <HeaderMenuButton
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            isActive={sidebarOpen}
            isCollapsible
            onClick={() => setSidebarOpen(!sidebarOpen)}
          />
          <HeaderName as={Link} to="/" prefix="">
            LoanTrack
          </HeaderName>
          <HeaderGlobalBar>
            <HeaderGlobalAction
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              tooltipAlignment="end"
              onClick={toggleTheme}
            >
              {theme === "light" ? <Asleep size={24} /> : <Light size={24} />}
            </HeaderGlobalAction>
            <div ref={panelWrapRef} className="lt-contents">
              <HeaderGlobalAction
                aria-label="Account"
                aria-expanded={panelOpen}
                isActive={panelOpen}
                tooltipAlignment="end"
                onClick={() => setPanelOpen((v) => !v)}
              >
                <UserAvatar size={24} />
              </HeaderGlobalAction>
              <HeaderPanel aria-label="Account menu" expanded={panelOpen} className="lt-header-panel">
                <div className="lt-header-user">
                  <div className="lt-header-user__name">{user?.full_name}</div>
                  <div className="lt-header-user__meta">{user?.email}</div>
                  <Tag className="lt-header-user__role" size="sm" type={isAdmin ? "blue" : "gray"}>
                    {isAdmin ? "Administrator" : "Borrower"}
                  </Tag>
                </div>
                <Button
                  kind="ghost"
                  size="lg"
                  className="lt-fit"
                  renderIcon={Settings}
                  onClick={() => {
                    setPanelOpen(false);
                    setShowSettings(true);
                  }}
                >
                  Account settings
                </Button>
                <Button kind="ghost" size="lg" className="lt-fit" renderIcon={Logout} onClick={handleLogout}>
                  Sign out
                </Button>
              </HeaderPanel>
            </div>
          </HeaderGlobalBar>
        </Header>
      </Theme>

      <SideNav
        aria-label="Side navigation"
        isRail={isDesktop}
        expanded={sidebarOpen}
        onOverlayClick={() => setSidebarOpen(false)}
      >
        <SideNavItems>
          {isAdmin ? (
            <>
              {ADMIN_PRIMARY.map(renderLink)}
              <SideNavDivider />
              <div className="lt-nav-label" aria-hidden="true">Administration</div>
              {ADMIN_SECONDARY.map(renderLink)}
            </>
          ) : (
            USER_NAV.map(renderLink)
          )}
        </SideNavItems>
      </SideNav>

      <Content id="main-content" className="lt-shell-main">
        <Outlet />
      </Content>

      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
