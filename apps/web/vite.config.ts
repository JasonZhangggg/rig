import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

// Two pages: the landing page at / and the app at /app/.
// In development, /api goes to the Rig server (pnpm dev:server).
export default defineConfig({
  plugins: [react()],
  define: { __RIG_VERSION__: JSON.stringify(version) },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: {
    rollupOptions: {
      input: { main: new URL("index.html", import.meta.url).pathname, app: new URL("app/index.html", import.meta.url).pathname, proto: new URL("proto/index.html", import.meta.url).pathname },
    },
  },
});
