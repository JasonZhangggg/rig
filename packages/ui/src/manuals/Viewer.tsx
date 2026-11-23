import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useModal } from "../components/modal";
import type { Manual, ManualPage } from "@rig/core";
import { useActions, useData, useStillPC } from "../state";
import { getCopy, putCopy } from "./cache";
import { closePdf, isCancelled, renderPage } from "./pdf";
import { HitList, useManualSearch } from "./Search";
import { useManuals } from "./useManuals";
import { closeManual, setViewerPage, useViewer } from "./viewerState";
import { partName } from "./words";

const zooms = [0.75, 1, 1.25, 1.5, 2, 3];

/** The manual viewer, over whatever screen opened it. Mounted once at the top of the app. */
export function ManualViewer() {
  const v = useViewer();
  if (!v.manualId) return null;
  return <Viewer key={v.manualId} manualId={v.manualId} page={v.page} />;
}

type File = { state: "loading" } | { state: "ready"; bytes: ArrayBuffer } | { state: "elsewhere" } | { state: "error"; message: string };

function Viewer({ manualId, page }: { manualId: string; page: number }) {
  const { client, ask } = useActions();
  const pc = useStillPC();
  const data = useData("answering");
  const { manuals } = useManuals();
  const manual = manuals?.find((m) => m.id === manualId);
  const [file, setFile] = useState<File>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useModal(box, true);

  // The copy on this device first, then the server, then keep a copy.
  useEffect(() => {
    if (!manual) return;
    let live = true;
    setFile({ state: "loading" });
    (async () => {
      const kept = await getCopy(manual.id);
      if (kept) return setFile({ state: "ready", bytes: kept });
      if (manual.source === "added") return live && setFile({ state: "elsewhere" });
      const bytes = await client.manualFile(pc.id, manual.id);
      void putCopy(manual.id, bytes);
      if (live) setFile({ state: "ready", bytes });
    })().catch((e: unknown) => live && setFile({ state: "error", message: e instanceof Error && e.message ? e.message : "Check your internet connection." }));
    return () => { live = false; };
  }, [client, pc.id, manual?.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (file.state === "ready") void closePdf(file.bytes); }, [file]);

  // Focus moves into the viewer and back to where it was when it closes.
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { if (back?.isConnected) back.focus(); };
  }, []);

  const [count, setCount] = useState(manual?.pageCount ?? 0);
  useEffect(() => { if (manual?.pageCount) setCount(manual.pageCount); }, [manual?.pageCount]);
  const last = Math.max(count, 1);
  const go = (n: number) => setViewerPage(Math.min(Math.max(1, n), last));

  // Esc closes; the arrow keys turn pages unless the person is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys typed in something open over the viewer, like Ctrl K search, are that one's to handle.
      if (e.target instanceof Node && e.target !== document.body && !box.current?.contains(e.target)) return;
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]") !== null;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeManual(); }
      else if (!typing && (e.key === "ArrowRight" || e.key === "PageDown")) { e.preventDefault(); go(page + 1); }
      else if (!typing && (e.key === "ArrowLeft" || e.key === "PageUp")) { e.preventDefault(); go(page - 1); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const askPage = () => {
    if (!manual) return;
    closeManual();
    ask(`Page ${page} of the ${manual.title}: what does it show, and what do I need to know from it?`);
  };

  return (
    <div className="mv-scrim" ref={box} onMouseDown={(e) => { if (e.target === e.currentTarget) closeManual(); }}>
      <div className="mv" role="dialog" aria-modal="true" aria-labelledby="mv-title">
        <header className="mv-head">
          <div className="mv-titles">
            <span className="label">{manual ? `${partName(manual)} manual` : "Manual"}</span>
            <h2 id="mv-title" className="plain-h">{manual?.title ?? "Manual"}</h2>
          </div>
          <div className="mv-head-actions">
            {manual?.url && <a className="btn ghost sm" href={manual.url} target="_blank" rel="noreferrer">On {manual.host ?? "the maker's site"}</a>}
            <button ref={close} type="button" className="btn ghost sm mv-close" onClick={closeManual} aria-label="Close the manual">✕</button>
          </div>
        </header>
        {!manual ? (
          <div className="mv-empty" role="status">{manuals == null ? "Opening the manual…" : `This manual isn't on ${pc.name} any more.`}</div>
        ) : (
          <div className="mv-body">
            <Rail manual={manual} page={page} go={go} />
            <div className="mv-main">
              <div className="mv-tools" role="toolbar" aria-label="Pages">
                <div className="mv-pager">
                  <button type="button" className="mv-icon" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page"><Chev dir="left" /></button>
                  <PageBox page={page} last={count} go={go} />
                  <button type="button" className="mv-icon" onClick={() => go(page + 1)} disabled={count > 0 && page >= count} aria-label="Next page"><Chev dir="right" /></button>
                </div>
                {file.state === "ready" && <Zoom z={zoom} setZ={setZoom} />}
                <button type="button" className="mv-text-btn mv-ask" onClick={askPage} disabled={data.answering}>Ask about this page</button>
              </div>
              <PageView manual={manual} page={page} zoom={zoom} file={file} onCount={setCount} retry={() => setAttempt((n) => n + 1)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Chev = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d={dir === "left" ? "M12 5l-5 5 5 5" : "M8 5l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function Zoom({ z, setZ }: { z: number; setZ: (z: number) => void }) {
  const i = zooms.indexOf(z);
  return (
    <div className="mv-zoom" role="group" aria-label="Zoom">
      <button type="button" className="mv-icon" onClick={() => setZ(zooms[Math.max(0, i - 1)])} disabled={i <= 0} aria-label="Zoom out">−</button>
      <button type="button" className="mv-text-btn mv-zoom-level" onClick={() => setZ(1)} title="Fit to width">{z === 1 ? "Fit" : `${Math.round(z * 100)}%`}</button>
      <button type="button" className="mv-icon" onClick={() => setZ(zooms[Math.min(zooms.length - 1, i + 1)])} disabled={i >= zooms.length - 1} aria-label="Zoom in">+</button>
    </div>
  );
}

function PageBox({ page, last, go }: { page: number; last: number; go: (n: number) => void }) {
  const [v, setV] = useState(String(page));
  useEffect(() => setV(String(page)), [page]);
  const commit = () => { const n = parseInt(v, 10); if (n > 0) go(n); else setV(String(page)); };
  return (
    <label className="mv-pagebox">
      <span className="sr-only">Page</span>
      <input className="num" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} aria-label="Page number" />
      <span className="faint">{last ? `of ${last}` : ""}</span>
    </label>
  );
}

/** The diagram pages, and find in this manual. */
function Rail({ manual, page, go }: { manual: Manual; page: number; go: (n: number) => void }) {
  const [q, setQ] = useState("");
  const { hits, error } = useManualSearch(q, manual.id);
  return (
    <aside className="mv-rail" aria-label="In this manual">
      <div className="mv-find">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in this manual" aria-label="Find in this manual" />
        {error && <p className="muted">{error}</p>}
        {hits && hits.length === 0 && !error && <p className="muted mv-none">Not in this manual.</p>}
        {hits && hits.length > 0 && <HitList hits={hits} showTitle={false} onOpen={(h) => { go(h.page); }} />}
      </div>
      {manual.diagrams.length > 0 && !hits && (
        <>
          <div className="label mv-rail-h">Diagrams</div>
          <ul className="mv-diagrams">
            {manual.diagrams.map((d) => (
              <li key={`${d.kind}-${d.page}`}>
                <button type="button" aria-current={d.page === page ? "page" : undefined} onClick={() => go(d.page)}>
                  <span>{d.label}</span><span className="num faint">p. {d.page}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!manual.indexed && <p className="faint mv-rail-note">Rig hasn't read this manual yet, so its diagrams and search aren't ready.</p>}
    </aside>
  );
}

function PageView({ manual, page, zoom, file, onCount, retry }: { manual: Manual; page: number; zoom: number; file: File; onCount: (n: number) => void; retry: () => void }) {
  const { client } = useActions();
  const pc = useStillPC();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [draw, setDraw] = useState<"drawing" | "ok" | "error">("drawing");
  const [text, setText] = useState<ManualPage | null | undefined>(undefined);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, el.clientWidth - 2));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [file.state]);

  useEffect(() => {
    if (file.state !== "ready" || !canvas.current || !width) return;
    let live = true;
    setDraw("drawing");
    renderPage(file.bytes, page, canvas.current, Math.round(width * zoom))
      .then((r) => { if (live) { onCount(r.pageCount); setDraw("ok"); } })
      .catch((e: unknown) => { if (live && !isCancelled(e)) setDraw("error"); });
    return () => { live = false; };
  }, [file, page, width, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Without the file, show the text Rig read from the page.
  useEffect(() => {
    if (file.state !== "elsewhere") return;
    let live = true;
    setText(undefined);
    client.manualPage(pc.id, manual.id, page).then((p) => live && setText(p)).catch(() => live && setText(null));
    return () => { live = false; };
  }, [client, pc.id, manual.id, page, file.state]);

  if (file.state === "loading") return <div className="mv-page mv-empty" role="status">Opening the manual…</div>;
  if (file.state === "error") {
    return (
      <div className="mv-page mv-empty" role="alert">
        <p>Rig couldn't get this manual's PDF. {file.message}</p>
        <button type="button" className="btn sm" onClick={retry}>Try again</button>
      </div>
    );
  }
  if (file.state === "elsewhere") {
    return (
      <div className="mv-page mv-textpage">
        <p className="mn-note">The PDF is on the device it was added on, so here's the text Rig read from page {page}.</p>
        {text === undefined ? <p className="muted" role="status">Loading the page…</p>
          : text ? <div className="mv-text">{text.text}</div>
          : <p className="muted">Rig doesn't have the text of this page.</p>}
      </div>
    );
  }
  return (
    <div className={`mv-page${zoom > 1 ? " zoomed" : ""}`} ref={wrap}>
      {draw === "error" && <div className="mv-empty" role="alert"><p>Rig couldn't draw page {page}.</p><button type="button" className="btn sm" onClick={retry}>Try again</button></div>}
      <canvas ref={canvas} className={`mv-canvas${draw === "drawing" ? " drawing" : ""}`} role="img" aria-label={`Page ${page} of the ${manual.title}`} hidden={draw === "error"} />
      {draw === "drawing" && <span className="mv-drawing" role="status">Drawing page {page}…</span>}
    </div>
  );
}
