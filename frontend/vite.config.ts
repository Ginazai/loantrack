import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the local FastAPI instance.
// In Docker, nginx handles this proxy itself (see nginx.conf).
export default defineConfig({
  plugins: [react()],
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
    chunkSizeWarningLimit: 800,
  },
});
