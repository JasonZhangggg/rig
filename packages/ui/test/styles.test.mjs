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

  // A row that scrolls sideways but is a pixel taller than itself (a tab's underline pulled down over the line)
  // gets a vertical scroll bar too, and Windows draws its arrows beside the tabs.
  it("lets tab rows scroll only sideways, with nothing hanging below them", () => {
    const rules = new Map();
    for (const file of cssFiles(stylesDir)) {
      postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
        const decls = rules.get(rule.selector) ?? {};
        rule.walkDecls((d) => { decls[d.prop] = d.value; });
        rules.set(rule.selector, decls);
      });
    }
    for (const [row, item] of [[".tabs", ".tabs button"], [".lg-views", ".lg-views a"]]) {
      const r = rules.get(row);
      expect(r, row).toBeTruthy();
      const y = r["overflow-y"] ?? r.overflow?.split(/\s+/)[1] ?? r.overflow;
      expect(y, `${row} overflow-y`).toMatch(/hidden|clip/);
      expect(rules.get(item)?.["margin-bottom"] ?? "0", `${item} margin-bottom`).not.toMatch(/^-/);
    }
  });
});

