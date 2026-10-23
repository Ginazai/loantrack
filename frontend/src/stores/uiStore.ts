import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Carbon themes in use: `white` for light, `g100` for dark. */
export type Theme = "light" | "dark";

/** Carbon zone class for each theme — applied to <html> so the whole page (body included) flips. */
const THEME_CLASS: Record<Theme, string> = { light: "cds--white", dark: "cds--g100" };

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove(THEME_CLASS.light, THEME_CLASS.dark);
  root.classList.add(THEME_CLASS[theme]);
  root.style.colorScheme = theme;
  root.dataset.theme = theme;
}

/** Accepts the legacy DaisyUI values ("ledger" / "ledger_dark") from before the Carbon migration. */
export function normalizeTheme(value: unknown): Theme {
  return value === "dark" || value === "ledger_dark" ? "dark" : "light";
}

// The side nav is persistent from Carbon's `lg` breakpoint (1056px) up; below that it's an overlay
// and must start closed or it would cover the page on first load.
const isDesktop = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(min-width: 66rem)").matches
    : true;

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: "light",
      sidebarOpen: isDesktop(),

      toggleTheme: () => {
        const next: Theme = get().theme === "light" ? "dark" : "light";
        applyTheme(next);
        set({ theme: next });
      },

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: "ui",
      partialize: (s) => ({ theme: s.theme }),
      // Migrate values persisted by the previous (DaisyUI) build.
      merge: (persisted, current) => ({
        ...current,
        theme: normalizeTheme((persisted as Partial<UIState> | undefined)?.theme),
      }),
    }
  )
);
