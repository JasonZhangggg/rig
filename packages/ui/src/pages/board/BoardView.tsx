import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { boardUsage, type BoardItem, type BoardShape, type PC, type SlotUse } from "@rig/core";
import { createBoardScene, pinGroups, pinNumber, type BoardHover, type BoardScene, type PinPalette } from "../../boardScene";
import { paletteOf } from "../../appearance";
import { useApp, useAppearance } from "../../state";
import { boardStage, useBoardShape } from "./boardStage";

/** Every slot's usage by item id, from the PC's live readings. */
export function useUsage(board: BoardShape) {
  const { pc } = useApp();
  return useMemo(() => {
    if (!pc.board) return [];
    const rpm: Record<string, number | null> = {};
    for (const r of pc.readings ?? []) if (r.type === "fan") rpm[r.id] = r.value;
    return boardUsage(board, pc.board, rpm);
  }, [board, pc.board, pc.readings]);
}

const stateWords: Record<SlotUse["state"], string> = { used: "In use", free: "Free", unknown: "Windows can't see what's plugged in here" };
/** Why Rig can't say, for the kinds where Windows sees part of the picture. */
const unknownWords: Partial<Record<BoardItem["kind"], string>> = {
  m2: "Windows doesn't say which M.2 slot a drive is in",
  pcie: "Rig can't see cards other than the graphics card",
  fan: "The board doesn't say which header each fan is on",
  power: "Optional. Windows can't tell if it's plugged in",
};

/** What the pointer is over, in a line or two: the item, what's in it, and the pin when it's on one. */
export function describe(item: BoardItem, use: SlotUse | undefined, pc: Pick<PC, "parts">, pin?: number) {
  const lines: string[] = [];
  if (item.kind === "socket" && pc.parts?.cpu) lines.push(pc.parts.cpu.name);
  else if (use) lines.push(use.what ? use.what : use.state === "unknown" ? unknownWords[item.kind] ?? stateWords.unknown : stateWords[use.state]);
  let pinLine: string | undefined;
  if (pin !== undefined && item.pins) {
    const n = pinNumber(item, pin);
    const named = pinGroups(item).find((g) => g.pins.some((q) => q.index === pin));
    const q = named?.pins.find((x) => x.index === pin);
    pinLine = named ? `Pin ${n}: ${named.name}${q?.sign ? ` ${q.sign}` : ""}` : `Pin ${n}`;
  }
  return { title: item.label, code: item.name && item.name !== item.label ? item.name : "", lines, pin: pinLine };
}

/**
 * The motherboard close up, in place of the 3D PC while the board is open: drag to move it around, right-drag to
 * turn it, scroll to zoom. Pointing at a slot or header says what it is and what's in it; clicking one zooms in,
 * with a pin map for headers whose pins have names.
 */
export function BoardView() {
  const board = useBoardShape();
  const { pc } = useApp();
  const usage = useUsage(board);
  const host = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const [tip, setTip] = useState<{ id: string; pin?: number } | null>(null);
  const [no3d, setNo3d] = useState(false);
  // The board's marks and pins in the app's data colors, so they follow Settings, Appearance.
  const look = useAppearance();
  const colorKey = useMemo(() => {
    const p = paletteOf(look);
    return JSON.stringify({ good: p.colors.good, look: p.colors.look, expected: p.colors.expected, goodMark: p.goodMark, lookText: p.lookText });
  }, [look]);
  const sceneRef = useRef<BoardScene | null>(null);
  // Slots Rig can place get a mark on the board: filled when in use, an outline when free.
  const marks = useMemo(() => {
    const m: Record<string, "used" | "free"> = {};
    for (const g of usage) if (g.bySlot) for (const s of g.slots) if (s.state !== "unknown") m[s.id] = s.state;
    return m;
  }, [usage]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  useEffect(() => { sceneRef.current?.setUsage(marks); }, [marks]);

  useEffect(() => {
    const place = (h: BoardHover) => {
      at.current = { x: h.x, y: h.y };
      placeTip();
    };
    let s: ReturnType<typeof createBoardScene>;
    try {
      const pins = JSON.parse(colorKey) as PinPalette;
      s = createBoardScene(host.current!, board, {
        accent: pins.good,
        used: pins.good,
        pins,
        dragToPan: true,
        landmarks: false,
        onHover: (h) => {
          boardStage.pointed(h?.id ?? null);
          if (!h) { setTip(null); return; }
          place(h);
          setTip((t) => (t && t.id === h.id && t.pin === h.pin ? t : { id: h.id, pin: h.pin }));
        },
      });
    } catch {
      setNo3d(true); // no WebGL: the Slots tab still reads fine
      return;
    }
    s.setUsage(marksRef.current);
    sceneRef.current = s;
    boardStage.attach(s);
    return () => { sceneRef.current = null; boardStage.attach(null); boardStage.pointed(null); s.dispose(); };
  }, [board, colorKey]);

  // Beside the pointer, flipped to its left where it would run under the pin map or off the view.
  function placeTip() {
    const el = tipRef.current, box = host.current;
    if (!el || !box) return;
    const card = box.querySelector<HTMLElement>(".pinout:not([hidden])");
    const right = card && card.offsetTop < at.current.y + el.offsetHeight + 16 ? card.offsetLeft - 8 : box.clientWidth - 8;
    const x = at.current.x + 14 + el.offsetWidth > right ? at.current.x - 14 - el.offsetWidth : at.current.x + 14;
    const y = Math.min(at.current.y + 16, box.clientHeight - el.offsetHeight - 8);
    el.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
  }
  // The tip takes its place when it first shows, before the next pointer move.
  useLayoutEffect(placeTip, [tip]);

  const item = tip ? board.items.find((i) => i.id === tip.id) : undefined;
  const use = item ? usage.flatMap((g) => g.slots).find((s) => s.id === item.id) : undefined;
  const d = item ? describe(item, use, pc, tip?.pin) : null;
  return (
    <div className="board-stage" ref={host} aria-label={`${board.model}, close up`} role="img">
      {d && (
        <div className={`board-tip${use ? ` is-${use.state}` : ""}`} ref={tipRef} aria-hidden="true">
          <b>{d.title}{d.code && <small>{d.code}</small>}</b>
          {d.lines.map((l) => <span key={l}>{l}</span>)}
          {d.pin && <span className="board-tip-pin">{d.pin}</span>}
        </div>
      )}
      <div className="board-top">
        {no3d ? <p className="board-hint faint">This screen can't draw the board in 3D.</p> : <>
          <p className="board-hint faint">Drag to move · Right-drag to turn · Scroll to zoom · Click a slot or header for a closer look</p>
          {Object.keys(marks).length > 0 && <p className="board-key" aria-hidden="true"><i className="is-used" />In use<i className="is-free" />Free</p>}
        </>}
      </div>
    </div>
  );
}
