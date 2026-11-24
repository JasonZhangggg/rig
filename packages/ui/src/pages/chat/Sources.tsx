import { Fragment, type ReactNode } from "react";
import { parseManualLink, type Source } from "@rig/core";
import { openManualLink } from "../../manuals/viewerState";

interface Page { n: number; url: string; label: string }
type Item =
  | { kind: "manual"; key: string; title: string; url: string; pages: Page[] }
  | { kind: "other"; key: string; source: Source };

/** One entry per manual, its pages in order; everything else as it came. Order follows the first time each shows up. */
function groupSources(sources: Source[]): Item[] {
  const items: Item[] = [];
  const manuals = new Map<string, Extract<Item, { kind: "manual" }>>();
  for (const s of sources) {
    const link = parseManualLink(s.url);
    if (!link) { items.push({ kind: "other", key: `${s.kind}:${s.label}`, source: s }); continue; }
    const id = link.manualId;
    let item = manuals.get(id);
    if (!item) {
      item = { kind: "manual", key: `manual:${id}`, title: s.label.replace(/,\s*(?:page|p\.)\s*\d+.*$/i, ""), url: s.url!, pages: [] };
      manuals.set(id, item);
      items.push(item);
    }
    const n = link.page;
    if (n && !item.pages.some((p) => p.n === n)) item.pages.push({ n, url: s.url!, label: s.label });
  }
  for (const it of manuals.values()) it.pages.sort((a, b) => a.n - b.n);
  return items;
}

function ManualItem({ item }: { item: Extract<Item, { kind: "manual" }> }) {
  if (!item.pages.length) return <button type="button" className="source-link" onClick={() => openManualLink(item.url)}>{item.title}</button>;
  return (
    <>
      {item.title},{" "}
      <span className="source-pages">p.{" "}
        {item.pages.map((p, i) => (
          <Fragment key={p.n}>
            {i > 0 && ", "}
            <button type="button" className="source-link" aria-label={`${item.title}, page ${p.n}`} title={p.label} onClick={() => openManualLink(p.url)}>{p.n}</button>
          </Fragment>
        ))}
      </span>
    </>
  );
}

function OtherItem({ source: s }: { source: Source }): ReactNode {
  return s.url
    ? <a className="source-link" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
    : s.label;
}

/** Where an answer came from, as one line of small print: each manual named once with its pages, which open the viewer there. */
export function Sources({ sources }: { sources: Source[] }) {
  const items = groupSources(sources);
  if (!items.length) return null;
  return (
    <p className="sources">
      <span className="sources-head">Sources</span>
      {items.map((it, i) => (
        <Fragment key={it.key}>
          {i > 0 && <span className="sources-dot" aria-hidden="true"> · </span>}
          <span className="source">{it.kind === "manual" ? <ManualItem item={it} /> : <OtherItem source={it.source} />}</span>
        </Fragment>
      ))}
    </p>
  );
}
