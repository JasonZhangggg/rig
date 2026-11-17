import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build:single` makes one self-contained HTML file you can open
// directly or share; the normal build is what the Tauri app will load.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  base: "./",
  build: { outDir: mode === "single" ? "dist-single" : "dist", chunkSizeWarningLimit: 1500 },
}));
