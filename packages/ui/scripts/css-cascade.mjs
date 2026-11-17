// Just enough of the CSS cascade to tell when moving or rewriting a rule could
// change which declaration wins.
export function specificity(sel) {
  let a = 0, b = 0, c = 0;
  sel.each(function visit(n) {
    if (n.type === "id") a++;
    else if (n.type === "class" || n.type === "attribute") b++;
    else if (n.type === "tag") c++;
    else if (n.type === "pseudo") {
      const name = n.value.toLowerCase();
      if (name.startsWith("::") || [":before", ":after", ":first-line", ":first-letter"].includes(name)) c++;
      else if (name === ":where") { /* zero */ }
      else if (n.nodes.length && [":is", ":not", ":has", ":matches", ":-webkit-any"].includes(name)) {
        const best = n.nodes.map(specificity).reduce((m, s) => (cmp(s, m) > 0 ? s : m), [0, 0, 0]);
        a += best[0]; b += best[1]; c += best[2];
      } else b++;
    }
  });
  return [a, b, c];
}
export const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

export function subject(sel) {
  const parts = { tags: new Set(), ids: new Set(), classes: new Set(), pseudoEl: "" };
  const nodes = sel.nodes;
  let i = nodes.length - 1;
  while (i >= 0 && nodes[i].type !== "combinator") {
    const n = nodes[i];
    if (n.type === "tag") parts.tags.add(n.value.toLowerCase());
    if (n.type === "id") parts.ids.add(n.value);
    if (n.type === "class") parts.classes.add(n.value);
    if (n.type === "pseudo" && (n.value.startsWith("::") || [":before", ":after"].includes(n.value))) parts.pseudoEl = n.value.replace(/^:+/, "");
    i--;
  }
  return parts;
}

// Whether two selectors could style the same box. Classes are assumed to name
// one component each, so selectors whose subjects share no class are kept apart.
export function overlap(x, y) {
  if (x.pseudoEl !== y.pseudoEl) return false;
  if (x.tags.size && y.tags.size && ![...x.tags].some((t) => y.tags.has(t))) return false;
  if (x.ids.size && y.ids.size && ![...x.ids].some((t) => y.ids.has(t))) return false;
  if (x.classes.size && y.classes.size && ![...x.classes].some((t) => y.classes.has(t))) return false;
  return true;
}
export const sameProp = (p, q) => p === q || (!p.startsWith("--") && !q.startsWith("--") && (p.startsWith(q + "-") || q.startsWith(p + "-")));

