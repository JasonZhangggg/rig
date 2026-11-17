#!/usr/bin/env node
// Flattens the design mockup's layered, attribute-scoped stylesheets into one
// stylesheet for a single fixed look.
//
//   node packages/ui/scripts/flatten-theme.mjs <mockup-src-dir> <out.css>
//
// The mockup scopes its looks with attributes on <html> (data-style, data-skin,
// data-colors, data-widgets, data-mode). Rules for the chosen values keep their
// selectors minus those qualifiers; rules for any other value are dropped.
// Stripping a qualifier lowers a selector's specificity, which can change which
// rule wins, so any selector that would lose a fight it used to win gets its
// specificity back as :root (same weight as an attribute, and <html> is the root).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { cmp, overlap, sameProp, specificity, subject } from "./css-cascade.mjs";

export const look = { "data-style": "blend", "data-skin": "mix", "data-colors": "denim", "data-widgets": "accents", "data-mode": "light" };
export const files = ["styles.css", "styles-v6.css", "styles-v9.css", "styles-v10.css", "styles-v11.css"];

const rootAttrs = new Set(Object.keys(look));
const isRootAttr = (n) => n.type === "attribute" && rootAttrs.has(n.attribute);
const attrMatches = (n) => (n.value === undefined ? true : look[n.attribute] === n.value);
const ARG_PSEUDOS = new Set([":is", ":where", ":not", ":matches", ":-webkit-any"]);

// Returns false when the selector can't match the chosen look, else strips the
// root qualifiers in place and returns true.
function resolve(sel) {
  let ok = true;
  sel.walkPseudos((p) => {
    if (!ok || !ARG_PSEUDOS.has(p.value.toLowerCase())) return;
    const hasRoot = p.nodes.some((s) => { let f = false; s.walk((n) => { if (isRootAttr(n)) f = true; }); return f; });
    if (!hasRoot) return;
    const kept = [];
    let anyTrue = false;
    for (const inner of p.nodes) {
      const clone = inner.clone();
      if (!resolve(clone)) continue;
      if (clone.toString().trim() === "") anyTrue = true;
      else kept.push(clone);
    }
    const negated = p.value.toLowerCase() === ":not";
    if (negated) {
      if (anyTrue) { ok = false; return; }
      if (!kept.length) { p.remove(); return; }
    } else {
      if (anyTrue) { p.remove(); return; }
      if (!kept.length) { ok = false; return; }
    }
    p.nodes = [];
    kept.forEach((k) => p.append(k));
  });
  if (!ok) return false;
  sel.walkAttributes((n) => {
    if (!isRootAttr(n)) return;
    if (!attrMatches(n)) ok = false;
    else n.remove();
  });
  if (!ok) return false;
  // A compound left empty was the root itself; drop it with its combinator.
  const first = sel.nodes[0];
  if (first && first.type === "combinator" && first.value.trim() === "") first.remove();
  return true;
}

export function flatten(srcDir) {
  const root = postcss.root();
  for (const f of files) root.append(postcss.parse(readFileSync(join(srcDir, f), "utf8"), { from: f }).nodes);

  const entries = [];
  const parser = selectorParser();
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const ast = parser.astSync(rule.selector);
    const kept = [];
    for (const sel of ast.nodes) {
      const orig = specificity(sel);
      const clone = sel.clone();
      if (!resolve(clone)) continue;
      let text = clone.toString().trim();
      if (!text) text = ":root";
      const flat = parser.astSync(text).nodes[0];
      kept.push({ text, orig, now: specificity(flat), subject: subject(flat), boost: 0 });
    }
    if (!kept.length) { rule.remove(); return; }
    const decls = [];
    rule.each((d) => { if (d.type === "decl") decls.push({ prop: d.prop.toLowerCase(), important: d.important }); });
    entries.push({ rule, kept, decls });
  });

  // Restore specificity wherever stripping flips a winner, until nothing flips.
  const declIndex = new Map();
  entries.forEach((e, order) => e.decls.forEach((d) => e.kept.forEach((s) => {
    const key = d.prop.startsWith("--") ? d.prop : d.prop.split("-")[0];
    if (!declIndex.has(key)) declIndex.set(key, []);
    declIndex.get(key).push({ order, prop: d.prop, important: d.important, s });
  })));
  const eff = (s) => [s.now[0], s.now[1] + s.boost, s.now[2]];
  let changed = true;
  while (changed) {
    changed = false;
    for (const list of declIndex.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const x = list[i], y = list[j];
          if (x.s === y.s || x.important !== y.important || !sameProp(x.prop, y.prop) || !overlap(x.s.subject, y.s.subject)) continue;
          const was = cmp(x.s.orig, y.s.orig) > 0 ? "x" : "y";
          const is = cmp(eff(x.s), eff(y.s)) > 0 ? "x" : "y";
          if (was === is) continue;
          const lost = was === "x" ? x.s : y.s;
          lost.boost = lost.orig[1] - lost.now[1];
          changed = true;
        }
      }
    }
  }

  let boosted = 0;
  for (const { rule, kept } of entries) {
    rule.selector = kept.map((s) => {
      if (!s.boost) return s.text;
      boosted++;
      const extra = ":root".repeat(s.boost);
      if (s.text.startsWith(":root")) return extra + s.text;
      if (/^html\b/.test(s.text)) return `html${extra}${s.text.slice(4)}`;
      return `${extra} ${s.text}`;
    }).join(",\n");
  }
  root.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) at.remove(); });
  return { css: root.toString(), rules: entries.length, boosted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error("usage: flatten-theme.mjs <mockup-src-dir> <out.css>"); process.exit(2); }
  const { css, rules, boosted } = flatten(src);
  writeFileSync(out, `/* Generated by flatten-theme.mjs for ${JSON.stringify(look)} */\n${css}`);
  console.log(`${rules} rules kept, ${boosted} selectors needed :root to keep their weight -> ${out}`);
}
