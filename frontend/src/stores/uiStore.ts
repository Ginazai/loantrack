import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "ledger" | "ledger_dark";

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: "ledger",
      sidebarOpen: true,

      toggleTheme: () => {
        const next = get().theme === "ledger" ? "ledger_dark" : "ledger";
        document.documentElement.setAttribute("data-theme", next);
        set({ theme: next });
      },

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    { name: "ui", partialize: (s) => ({ theme: s.theme }) }
  )
);

// Apply persisted theme on load
const stored = JSON.parse(localStorage.getItem("ui") || "{}");
const savedTheme = stored?.state?.theme;
document.documentElement.setAttribute(
  "data-theme",
  savedTheme === "ledger_dark" ? "ledger_dark" : "ledger"
);
