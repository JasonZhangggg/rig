import { useEffect, useState } from "react";
import { snippetParts, type ManualHit } from "@rig/core";
import { useApp } from "../state";

/** Searches the PC's manuals (or one of them) as the person types. */
export function useManualSearch(query: string, manualId?: string) {
  const { client, pc } = useApp();
  const [hits, setHits] = useState<ManualHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) { setHits(null); setError(null); return; }
    let live = true;
    const t = setTimeout(() => {
      client.searchManuals(pc.id, q, { manualId, limit: 20 })
        .then((h) => { if (live) { setHits(h); setError(null); } })
        .catch((e: unknown) => { if (live) { setHits([]); setError(e instanceof Error && e.message ? e.message : "Search didn't work just now."); } });
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [client, pc.id, q, manualId]);
  return { hits, error, q };
}

export function Snippet({ text }: { text: string }) {
  return <>{snippetParts(text).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

/** Search results: the manual, the page and the words around the match. */
export function HitList({ hits, onOpen, showTitle = true }: { hits: ManualHit[]; onOpen: (h: ManualHit) => void; showTitle?: boolean }) {
  return (
    <ul className="mn-hits">
      {hits.map((h) => (
        <li key={`${h.manualId}-${h.page}`}>
          <button type="button" className="mn-hit" onClick={() => onOpen(h)}>
            <span className="mn-hit-top">{showTitle && <b>{h.title}</b>}<span className="mn-page">Page {h.page}</span></span>
            <span className="mn-snippet"><Snippet text={h.snippet} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}
