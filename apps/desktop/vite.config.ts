import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri loads this dev server in its window. Opened in a normal browser, the
// app runs on a simulated PC so the screens can be worked on anywhere.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
