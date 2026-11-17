// One-off: removes CSS for the design options that weren't picked (Canvas,
// Workspace, the other sidebars and colors, and the mockup panel). Only
// selectors that can never match the app's markup are dropped.
// Usage: node tools/prune-css.mjs packages/ui/src/styles/base.css ...
import fs from "node:fs";
import postcss from "postcss";

const dead = [
  /\[data-style="(workbench|checkup)"\]/,
  /\[data-colors="(?!watermelon")[a-z]+"\]/,
  /\.(c|w|fc|fd)-[a-z]/,
  /\.shell-(canvas|work|fside|fcard|fdock|friendly)\b/,
  /\.f-(bar|nav|nav-btn|nav-text|logo|right|pcsw|pc-btn|pc-ava|pcsw-name|me|badge)\b/,
  /\.(mock|mrow|mnote|mbody|mswatches|mock-head)\b/,
  /\.(nav|nav-group|nav-label|nav-list|nav-setup|nav-foot|pc-switch)\b/,
];

for (const file of process.argv.slice(2)) {
  const root = postcss.parse(fs.readFileSync(file, "utf8"));
  let dropped = 0;
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    const keep = rule.selectors.filter((s) => !dead.some((re) => re.test(s)));
    dropped += rule.selectors.length - keep.length;
    if (!keep.length) rule.remove();
    else rule.selectors = keep;
  });
  root.walkAtRules((a) => { if (a.nodes && a.nodes.length === 0) a.remove(); });
  fs.writeFileSync(file, root.toString());
  console.log(`${file}: dropped ${dropped} selectors`);
}
