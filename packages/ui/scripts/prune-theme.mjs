#!/usr/bin/env node
// Narrows a flattened stylesheet to what an app can render, and folds rules
// that share a selector into one.
//
//   node packages/ui/scripts/prune-theme.mjs <flat.css> <out.css> <source-dir>...
//
// A selector is dropped when it names a class that appears nowhere in the
// sources. Rules left with the same selector in the same at-rule are merged, each
// property keeping the value that won in the original cascade.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { cmp, overlap, sameProp, specificity, subject } from "./css-cascade.mjs";

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules") continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) yield p;
  }
}

export function classesIn(dirs) {
  const words = new Set();
  for (const d of dirs) for (const f of walk(d)) {
    // Every word-like token counts, not only string contents: an apostrophe in
    // JSX text would throw off any pairing of quotes.
    for (const w of readFileSync(f, "utf8").split(/[^A-Za-z0-9_-]+/)) if (w) words.add(w);
  }
  return words;
}

export function prune(css, words) {
  const root = postcss.parse(css);
  const parser = selectorParser();
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const kept = parser.astSync(rule.selector).nodes.filter((sel) => {
      let ok = true;
      sel.walkClasses((c) => { if (!words.has(c.value)) ok = false; });
      return ok;
    });
    if (!kept.length) rule.remove();
    else rule.selector = kept.map((s) => s.toString().trim()).join(",\n");
  });
  root.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) at.remove(); });

  // Fold each rule into the last rule with the same selector and context, unless
  // a rule in between ties with it on specificity for a property it sets, since
  // moving past that rule would flip the tie.
  const rules = [];
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const ctx = [];
    for (let p = rule.parent; p && p.type === "atrule"; p = p.parent) ctx.push(`@${p.name} ${p.params}`);
    const sels = parser.astSync(rule.selector).nodes.map((n) => ({ spec: specificity(n), subject: subject(n) }));
    const props = [];
    rule.each((d) => { if (d.type === "decl") props.push(d.prop.toLowerCase()); });
    rules.push({ rule, key: `${ctx.join("|")}::${rule.selector}`, sels, props });
  });
  const ties = (a, b) => a.props.some((p) => b.props.some((q) => sameProp(p, q)))
    && a.sels.some((x) => b.sels.some((y) => cmp(x.spec, y.spec) === 0 && overlap(x.subject, y.subject)));
  let held = 0;
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (!r.rule.parent) continue;
    for (let j = i - 1; j >= 0; j--) {
      const e = rules[j];
      if (e.key !== r.key || !e.rule.parent) continue;
      if (rules.slice(j + 1, i).some((m) => m.rule.parent && m.key !== r.key && ties(e, m))) { held++; break; }
      const anchor = r.rule.first;
      e.rule.each((d) => { if (d.type === "decl") r.rule.insertBefore(anchor, d.clone()); });
      r.props.push(...e.props);
      e.rule.remove();
    }
  }
  root.walkRules((rule) => {
    const last = new Map();
    rule.each((d) => { if (d.type === "decl") last.set(`${d.prop}${d.important ? "!" : ""}`, d); });
    rule.each((d) => { if (d.type === "decl" && last.get(`${d.prop}${d.important ? "!" : ""}`) !== d) d.remove(); });
  });
  root.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) at.remove(); });
  return { css: root.toString(), held };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, out, ...dirs] = process.argv.slice(2);
  if (!input || !out || !dirs.length) { console.error("usage: prune-theme.mjs <flat.css> <out.css> <source-dir>..."); process.exit(2); }
  const { css, held } = prune(readFileSync(input, "utf8"), classesIn(dirs));
  writeFileSync(out, css);
  console.log(`${postcss.parse(css).nodes.length} top-level nodes, ${held} rules left unmerged to keep a tie -> ${out}`);
}
