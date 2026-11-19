import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

// Tauri loads this dev server in its window. Opened in a normal browser, the
// app runs on a simulated PC so the screens can be worked on anywhere.
export default defineConfig(({ command, mode }) => {
  const api = loadEnv(mode, process.cwd(), "VITE_").VITE_RIG_API || process.env.VITE_RIG_API;
  const installer = command === "build" && !!process.env.TAURI_ENV_PLATFORM && process.env.TAURI_ENV_DEBUG !== "true";
  if (installer && !api) {
    throw new Error("VITE_RIG_API is empty. Set it to the Rig server's address ending in /api (CI reads the RIG_API_URL repository variable). Without it the installed app can't sign in.");
  }
  return {
    plugins: [react()],
    clearScreen: false,
    // Cargo builds inside src-tauri while this runs, and Windows refuses to watch files it's writing (EBUSY).
    server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    define: { __RIG_VERSION__: JSON.stringify(version) },
    build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  };
});
