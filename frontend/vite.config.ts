import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the local FastAPI instance.
// In Docker, nginx handles this proxy itself (see nginx.conf.template).
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {
        // Carbon still ships some legacy Sass idioms; keep build output readable.
        quietDeps: true,
        silenceDeprecations: ["import", "global-builtin", "mixed-decls"],
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,   // disable in prod; enable for debugging
    chunkSizeWarningLimit: 900,
  },
});
