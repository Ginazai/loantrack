import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyTheme, normalizeTheme, useUIStore } from "./uiStore";

describe("normalizeTheme", () => {
  it("keeps 'dark' and maps the legacy 'ledger_dark' to dark", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("ledger_dark")).toBe("dark");
  });
  it("falls back to light for light, legacy light, and garbage", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("ledger")).toBe("light");
    expect(normalizeTheme(undefined)).toBe("light");
    expect(normalizeTheme(42)).toBe("light");
  });
});

describe("applyTheme", () => {
  it("puts the Carbon zone class, colour scheme and data attribute on <html>", () => {
    applyTheme("dark");
    const root = document.documentElement;
    expect(root.classList.contains("cds--g100")).toBe(true);
    expect(root.classList.contains("cds--white")).toBe(false);
    expect(root.style.colorScheme).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
  });
  it("swaps cleanly back to light", () => {
    applyTheme("dark");
    applyTheme("light");
    const root = document.documentElement;
    expect(root.classList.contains("cds--white")).toBe(true);
    expect(root.classList.contains("cds--g100")).toBe(false);
  });
});

describe("useUIStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ theme: "light", sidebarOpen: true });
  });

  it("toggleTheme flips the theme and applies it to the document", () => {
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("light");
  });

  it("setSidebarOpen updates the flag", () => {
    useUIStore.getState().setSidebarOpen(false);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  it("persists only the theme, not the sidebar state", () => {
    useUIStore.getState().toggleTheme();
    const saved = JSON.parse(localStorage.getItem("ui")!);
    expect(saved.state).toEqual({ theme: "dark" });
  });
});

describe("useUIStore initial state", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    localStorage.clear();
    vi.resetModules();
  });

  it("starts with the nav closed below the desktop breakpoint", async () => {
    vi.resetModules();
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    const { useUIStore: fresh } = await import("./uiStore");
    expect(fresh.getState().sidebarOpen).toBe(false);
  });

  it("starts with the nav open on desktop", async () => {
    vi.resetModules();
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const { useUIStore: fresh } = await import("./uiStore");
    expect(fresh.getState().sidebarOpen).toBe(true);
  });

  it("migrates a theme persisted by the old DaisyUI build", async () => {
    localStorage.setItem("ui", JSON.stringify({ state: { theme: "ledger_dark" }, version: 0 }));
    vi.resetModules();
    const { useUIStore: fresh } = await import("./uiStore");
    expect(fresh.getState().theme).toBe("dark");
  });
});
