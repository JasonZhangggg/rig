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

  // Hovering a pressed button, like Exploded view while it's on, once painted the plain button's pale hover under its
  // white words, so they all but vanished.
  it("keeps a pressed button's look under the pointer, with words that read", () => {
    const hovers = [];
    let pressed = null;
    for (const file of cssFiles(stylesDir)) {
      postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
        if (rule.selector === '.stage-tools .btn[aria-pressed="true"]') pressed = Object.fromEntries(rule.nodes.filter((d) => d.type === "decl").map((d) => [d.prop, d.value]));
        if (rule.parent?.type !== "atrule" || !/hover/.test(rule.parent.params)) return;
        for (const sel of rule.selectors) if (/^\.btn(\.ghost)?:/.test(sel) && sel.includes(":hover")) hovers.push(sel);
      });
    }
    expect(hovers.length).toBeGreaterThan(0);
    for (const sel of hovers) expect(sel, sel).toMatch(/:not\([^)]*\[aria-pressed="true"\]/);
    expect(pressed).toMatchObject({ background: "var(--sel)", color: "var(--text)" });
  });

  // At 390px My PC's tabs ran 2px past their row, so Safety showed cut off and the row slid sideways under a finger.
  it("fits My PC's tabs across a phone, and never lets a wide row widen the page", () => {
    const phone = {};
    for (const file of cssFiles(stylesDir)) {
      postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
        if (rule.parent?.type !== "atrule" || !/max-width:\s*760px/.test(rule.parent.params)) return;
        for (const sel of rule.selectors) { phone[sel] ??= {}; rule.walkDecls((d) => { phone[sel][d.prop] = d.value; }); }
      });
    }
    // Parts, Upgrades, Manuals and drivers and Safety measure 275px at 15px. The row has 346px, less 8px of room for focus
    // rings and 15px for a scroll bar where Windows draws one.
    const gap = parseFloat(phone[".lg-views"]?.gap ?? "22");
    expect(275 + 3 * gap).toBeLessThanOrEqual(346 - 8 - 15);
    expect(phone[".fp-frame"]?.["grid-template-columns"] ?? phone[".shell-fpanel.mini .fp-frame"]["grid-template-columns"]).toMatch(/^minmax\(0,\s*1fr\)$/);
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

