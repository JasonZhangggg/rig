import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");

// Windows and macOS ignore case, so "viewer.ts" next to "Viewer.tsx" makes an import resolve to the wrong file there.
describe("source files", () => {
  it("has no two names in a folder that differ only by case or extension", () => {
    const seen = new Map();
    const clashes = [];
    for (const e of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      const f = join(e.parentPath, e.name).slice(srcDir.length + 1);
      const key = f.replace(/\.(tsx?|css)$/, "").toLowerCase();
      if (seen.has(key)) clashes.push(`${seen.get(key)} / ${f}`);
      seen.set(key, f);
    }
    expect(clashes).toEqual([]);
  });

  // A date with options made a new formatter each call, about 60 µs, and charts and lanes make dozens per reading.
  it("words dates and times with dateText, which keeps one formatter per set of options", () => {
    const slow = [];
    for (const e of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.tsx?$/.test(e.name)) continue;
      const f = join(e.parentPath, e.name);
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/\.toLocale(Time|Date)?String\(\s*undefined\s*,/.test(line)) slow.push(`${f.slice(srcDir.length + 1)}:${i + 1}`);
      });
    }
    expect(slow).toEqual([]);
  });
});
