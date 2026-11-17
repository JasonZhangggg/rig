// The stylesheet carries no rules for markup the app never renders.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { describe, expect, it } from "vitest";
import { classesIn } from "../scripts/prune-theme.mjs";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");
const stylesDir = join(srcDir, "styles/");
const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []);

describe("stylesheet", () => {
  it("styles only classes that appear in the app's source", () => {
    const used = classesIn([srcDir]);
    const unused = new Set();
    for (const file of cssFiles(stylesDir)) {
      postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
        selectorParser((sel) => sel.walkClasses((c) => { if (!used.has(c.value)) unused.add(`${c.value} (${file.slice(stylesDir.length)})`); })).processSync(rule.selector);
      });
    }
    expect([...unused]).toEqual([]);
  });
});
