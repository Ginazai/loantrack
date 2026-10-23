import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React Testing Library doesn't auto-cleanup under vitest the way it does
// under Jest — without this, DOM from one test can leak into the next.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement ResizeObserver, which Carbon's Modal uses to measure its content.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom has no matchMedia; the layout and store read it to pick nav behavior.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
