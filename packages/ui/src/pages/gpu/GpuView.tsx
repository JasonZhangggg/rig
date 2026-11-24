import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { plugPinout, type CardUse, type GpuPorts, type OutputUse } from "@rig/core";
import { createGpuScene, type GpuHover, type GpuScene } from "../../gpuScene";
import { paletteOf } from "../../appearance";
import { useAppearance } from "../../state";
import { gpuStage, useCard } from "./gpuStage";

/** What the pointer is over on the card, in a line or two: the output or plug, what's on it, and the pin when it's on one. */
export function describePort(id: string, p: GpuPorts, use: CardUse, pin?: number) {
  const out = p.outputs.find((o) => o.id === id);
  if (out) {
    const g = use.groups.find((x) => x.kind === out.kind);
    const u = g?.outputs.find((o) => o.id === id);
    return { title: out.label, code: out.version ?? "", state: u?.state, lines: [outputLine(u, g?.screens.map((s) => s.split(",")[0]) ?? [], g?.outputs.length ?? 1)] };
  }
  const plug = p.power.find((x) => x.id === id);
  if (!plug) return null;
  const po = plugPinout(plug.kind);
  const pins = [...po.rows.flat(), ...(po.sense ?? [])];
  const at = pin !== undefined ? pins[pin] : undefined;
  return {
    title: plug.label, code: plug.kind === "16-pin" ? "12V-2x6" : "PCIe", state: undefined,
    lines: ["From the power supply. The card won't start without it."],
    pin: at ? (at.number ? `Pin ${at.number}: ${at.name}` : at.name === "Power" ? "Power pin (+12V or ground)" : `${at.name} pin`) : undefined,
  };
}

function outputLine(u: OutputUse | undefined, screens: string[], of: number) {
  if (!u) return "";
  const names = screens.join(" and ");
  if (u.state === "used") return u.screen ? `${u.screen} is on it` : of > 1 ? `In use. ${names} ${screens.length === 1 ? "is" : "are"} on these, and Windows doesn't say which is where.` : "In use";
  if (u.state === "some") return `${names} ${screens.length === 1 ? "is on one" : `are on ${screens.length}`} of these ${of}. Windows doesn't say which.`;
  if (u.state === "free") return "Free";
  return "Windows didn't say which plug each screen uses";
}

/**
 * The graphics card close up, in place of the 3D PC while the card is open: drag to move, right-drag to turn,
 * scroll to zoom. Pointing at an output says what's on it; clicking zooms in, with a pin map on a power plug.
 */
export function GpuView() {
  const c = useCard();
  const host = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const [tip, setTip] = useState<{ id: string; pin?: number } | null>(null);
  const [no3d, setNo3d] = useState(false);
  const look = useAppearance();
  const accent = useMemo(() => paletteOf(look).colors.good, [look]);
  const sceneRef = useRef<GpuScene | null>(null);
  const marks = useMemo(() => {
    const m: Record<string, "used" | "free" | "some"> = {};
    for (const g of c?.use.groups ?? []) for (const o of g.outputs) if (o.state !== "unknown") m[o.id] = o.state;
    return m;
  }, [c]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  useEffect(() => { sceneRef.current?.setUsage(marks); }, [marks]);

  const shape = c?.shape;
  useEffect(() => {
    if (!shape) return;
    let s: GpuScene;
    try {
      // A card Rig doesn't know is drawn without outputs or plugs, rather than with a guess at them.
      s = createGpuScene(host.current!, shape, shape.ports ?? { outputs: [], power: [], from: "", exact: false }, {
        accent,
        onHover: (h: GpuHover | null) => {
          gpuStage.pointed(h?.id ?? null);
          if (!h) { setTip(null); return; }
          at.current = { x: h.x, y: h.y };
          placeTip();
          setTip((t) => (t && t.id === h.id && t.pin === h.pin ? t : { id: h.id, pin: h.pin }));
        },
      });
    } catch {
      setNo3d(true);
      return;
    }
    s.setUsage(marksRef.current);
    sceneRef.current = s;
    gpuStage.attach(s);
    return () => { sceneRef.current = null; gpuStage.attach(null); gpuStage.pointed(null); s.dispose(); };
  }, [shape, accent]);

  function placeTip() {
    const el = tipRef.current, box = host.current;
    if (!el || !box) return;
    const card = box.querySelector<HTMLElement>(".pinout:not([hidden])");
    const right = card && card.offsetTop < at.current.y + el.offsetHeight + 16 ? card.offsetLeft - 8 : box.clientWidth - 8;
    const x = at.current.x + 14 + el.offsetWidth > right ? at.current.x - 14 - el.offsetWidth : at.current.x + 14;
    const y = Math.min(at.current.y + 16, box.clientHeight - el.offsetHeight - 8);
    el.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
  }
  useLayoutEffect(placeTip, [tip]);

  if (!c) return null;
  const d = tip && shape?.ports ? describePort(tip.id, shape.ports, c.use, tip.pin) : null;
  const some = Object.values(marks).includes("some");
  return (
    <div className="board-stage gpu-stage" ref={host} aria-label={`${shape!.model}, close up`} role="img">
      {d && (
        <div className={`board-tip${d.state ? ` is-${d.state}` : ""}`} ref={tipRef} aria-hidden="true">
          <b>{d.title}{d.code && <small>{d.code}</small>}</b>
          {d.lines.map((l) => <span key={l}>{l}</span>)}
          {d.pin && <span className="board-tip-pin">{d.pin}</span>}
        </div>
      )}
      <div className="board-top">
        {no3d ? <p className="board-hint faint">This screen can't draw the card in 3D.</p> : <>
          <p className="board-hint faint">Drag to move · Right-drag to turn · Scroll to zoom{shape?.ports?.outputs.length ? " · Click an output or the power plug for a closer look" : shape?.ports?.power.length ? " · Click the power plug for a closer look" : ""}</p>
          {Object.keys(marks).length > 0 && <p className="board-key" aria-hidden="true"><i className="is-used" />In use<i className="is-free" />Free{some && <><i className="is-some" />One of these</>}</p>}
        </>}
      </div>
    </div>
  );
}
