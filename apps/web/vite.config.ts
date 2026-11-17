import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two pages: the landing page at / and the app at /app/.
// In development, /api goes to the Rig server (pnpm dev:server).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: {
    rollupOptions: {
      input: { main: new URL("index.html", import.meta.url).pathname, app: new URL("app/index.html", import.meta.url).pathname },
    },
  },
});
