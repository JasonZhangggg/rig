import { defineConfig } from "vitest/config";

// Each test starts its own in-memory Postgres (PGlite). The first one compiles
// the WebAssembly, which takes longer than vitest's 5 seconds when the other
// packages' tests run at the same time.
export default defineConfig({ test: { testTimeout: 30_000 } });
