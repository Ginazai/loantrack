import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts (the production build config) so test-only
// settings — jsdom environment, coverage thresholds, setup files — never
// risk leaking into what actually ships.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"], // lcov feeds SonarQube (CI)
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/test/**",
        // Tests themselves are not application code; counting them inflates the %.
        "src/**/*.test.{ts,tsx}",
      ],
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 80 },
    },
  },
});
