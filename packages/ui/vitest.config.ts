import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

// From Node 25 on, Node has a localStorage of its own that hides jsdom's, and without a file to back it, it's
// undefined. Turning it off lets the tests see jsdom's, as on Node 20 and 22.
const nodeStorage = Number(process.versions.node.split(".")[0]) >= 25 ? ["--no-experimental-webstorage"] : [];

export default defineConfig({
  define: { __RIG_VERSION__: JSON.stringify(version) },
  test: {
    environment: "jsdom", css: false, setupFiles: ["./test/setup.ts"],
    poolOptions: { forks: { execArgv: nodeStorage }, threads: { execArgv: nodeStorage } },
  },
});
