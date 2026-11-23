// The motherboard's layout, read from its manual without the person asking.
// When Rig sees a PC's board it looks, in order, for the layout kept on this
// device, then the one the server keeps for that board model (read once for
// everyone), and only then finds the manual, reads it and has the server read
// its layout drawing. Each step that has the answer stops there, so a board is
// read once in all, and a PC that has it already does no work at all.

import { useEffect, useSyncExternalStore } from "react";
import { boardKey, layoutFromReading, manualTargets, type BoardLayout, type BoardShape, type Manual, type ManualTarget, type RigClient } from "@rig/core";
import { useActions, useData, useStillPC } from "../state";
import { getCopy, putCopy } from "./cache";
import { manualStore, type ManualStore } from "./useManuals";

const PREFIX = "rig-board-layout:";
/** How long to wait between looks while another PC's read of the same board runs. */
export const WAIT_MS = 15_000;
const WAITS = 8;

export function keptLayout(maker: string, model: string): BoardLayout | null {
  try {
    const v = localStorage.getItem(PREFIX + boardKey(maker, model));
    return v ? (JSON.parse(v) as BoardLayout) : null;
  } catch { return null; }
}

function keep(l: BoardLayout, maker: string, model: string) {
  try { localStorage.setItem(PREFIX + boardKey(maker, model), JSON.stringify(l)); } catch { /* storage full or off: the server still has it */ }
}

/** The layout page as a picture the reader can use, and its text and the next page's. */
export interface LayoutPage { image: string; mediaType: "image/png" | "image/jpeg"; width: number; height: number }
export type RenderForReading = (bytes: ArrayBuffer, page: number) => Promise<LayoutPage>;

export interface BoardLayoutDeps {
  client: RigClient;
  pcId: string;
  manuals: ManualStore;
  render: RenderForReading;
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The board manual's page most likely to hold the whole-board drawing. */
export function layoutPage(m: Manual): number | null {
  return m.diagrams.find((d) => d.kind === "board-layout")?.page ?? null;
}

/**
 * Gets the board's layout once, by the cheapest route that has it. Null when
 * there's none to be had (not signed in, no manual, no drawing Rig can read).
 */
export async function ensureBoardLayout(t: ManualTarget, d: BoardLayoutDeps): Promise<BoardLayout | null> {
  const { client, pcId } = d;
  const wait = d.wait ?? sleep;
  const kept = keptLayout(t.maker, t.model);
  if (kept) return kept;
  if (!client.boardLayout || !client.readBoardLayout) return null;

  const done = (l: BoardLayout) => { keep(l, t.maker, t.model); return l; };
  const shared = await client.boardLayout(pcId, t.maker, t.model);
  if (shared.status === "done" && shared.layout) return done(shared.layout);
  if (shared.status === "failed") return null;
  if (shared.status === "reading") return waitFor(t, d, wait);

  // Nobody has read this board yet: the manual first (found once for everyone, read once per PC).
  await d.manuals.load();
  let m = boardManual(d.manuals, t);
  if (!m || !m.indexed) {
    if (!m) await d.manuals.find(t); else await d.manuals.read(m);
    m = boardManual(d.manuals, t);
  }
  if (!m || m.source !== "found" || !m.indexed) return null;
  const page = layoutPage(m);
  if (!page) return null;

  let bytes = await getCopy(m.id);
  if (!bytes) { bytes = await client.manualFile(pcId, m.id); await putCopy(m.id, bytes); }
  const pic = await d.render(bytes, page);
  const words = await Promise.all([page, page + 1].map((n) => client.manualPage(pcId, m!.id, n).catch(() => null)));
  const text = words.map((p) => p?.text ?? "").join("\n").trim().slice(0, 6000) || undefined;
  const r = await client.readBoardLayout(pcId, m.id, { page, ...pic, text });
  if (r.status === "done" && r.layout) return done(r.layout);
  return r.status === "reading" ? waitFor(t, d, wait) : null;
}

async function waitFor(t: ManualTarget, d: BoardLayoutDeps, wait: (ms: number) => Promise<void>): Promise<BoardLayout | null> {
  for (let i = 0; i < WAITS; i++) {
    await wait(WAIT_MS);
    const r = await d.client.boardLayout!(d.pcId, t.maker, t.model);
    if (r.status === "done" && r.layout) { keep(r.layout, t.maker, t.model); return r.layout; }
    if (r.status !== "reading") return null;
  }
  return null;
}

function boardManual(s: ManualStore, t: ManualTarget): Manual | undefined {
  return (s.get().manuals ?? []).find((m) => m.part === t.part && m.kind === "motherboard");
}

// One run per PC and board while the app is open, however many screens ask.
const runs = new Map<string, Promise<BoardLayout | null>>();

/** Starts (or joins) the board's layout read for a PC. */
export function boardLayoutFor(t: ManualTarget, d: BoardLayoutDeps): Promise<BoardLayout | null> {
  const key = `${d.pcId}|${boardKey(t.maker, t.model)}`;
  let run = runs.get(key);
  if (!run) {
    run = ensureBoardLayout(t, d).catch(() => null);
    runs.set(key, run);
    // A miss can be tried again next time the app opens; a layout is kept anyway.
    void run.then((l) => { if (!l) setTimeout(() => runs.delete(key), 60_000); });
  }
  return run;
}

/** The board shape the 3D views draw, from a read layout. */
export const boardShape = (l: BoardLayout): Omit<BoardShape, "source"> => layoutFromReading(l);

/** For tests: forget the runs started so far. */
export function forgetRuns() { runs.clear(); }

// ---------- on screen ----------

const shown = new Map<string, BoardLayout | null>();
const listeners = new Set<() => void>();
const announce = (key: string, l: BoardLayout | null) => { shown.set(key, l); listeners.forEach((f) => f()); };

/**
 * Starts the on-screen PC's board layout read as soon as Rig knows the board,
 * signed in, and gives back the layout once there is one.
 */
export function useBoardLayout(): BoardLayout | null {
  const { client } = useActions();
  const pc = useStillPC();
  const data = useData("account");
  const target = manualTargets(pc).find((t) => t.kind === "motherboard");
  const key = target ? `${pc.id}|${boardKey(target.maker, target.model)}` : "";
  const signedIn = !!data.account;
  const layout = useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => shown.get(key) ?? null, () => null);
  useEffect(() => {
    if (!target || !signedIn) return;
    let live = true;
    void boardLayoutFor(target, { client, pcId: pc.id, manuals: manualStore(client, pc.id), render: renderLayoutPage }).then((l) => { if (live) announce(key, l); });
    return () => { live = false; };
  }, [key, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  return layout;
}

const renderLayoutPage: RenderForReading = async (bytes, page) => (await import("./pdf")).renderForReading(bytes, page);
