import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { AsciiField } from "../components/AsciiField";
import { PCPreview } from "../components/PCPreview";
import { createScene } from "../scene";
import { sceneTheme } from "../themes";
import { reducedMotion } from "../appearance";
import "../styles/scene-labels.css";
import homeShot from "../assets/signin-home.webp";

/** Preview only: the left half of the sign-in screens in a few looks. Pick one with ?art=studio, night or glimpse. */
type Art = "ascii" | "studio" | "night" | "glimpse" | "exploded" | "number" | "bento";
const arts: Art[] = ["ascii", "studio", "night", "glimpse", "exploded", "number", "bento"];

function pickArt(): Art {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("art");
  return arts.includes(v as Art) ? (v as Art) : "ascii";
}

export function SignInArt() {
  const art = pickArt();
  if (art === "studio") return <ArtPC tone="light" />;
  if (art === "night") return <ArtPC tone="dark" />;
  if (art === "glimpse") return <ArtGlimpse />;
  if (art === "exploded") return <ArtExploded />;
  if (art === "number") return <ArtNumber />;
  if (art === "bento") return <ArtBento />;
  return (
    <div className="signin-art tone-dark">
      <AsciiField fit={{ size: 0.78 }} />
      <Brand />
      <p className="art-note">See inside your PC.</p>
    </div>
  );
}

const Brand = () => <div className="brand"><span className="brand-mark" />Rig</div>;

const Copy = () => (
  <div className="art-copy">
    <h2>See inside your PC.</h2>
    <p>Live temperatures for every part, problems in plain words, and fixes you approve.</p>
  </div>
);

function useDemoPC() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => {
    let live = true;
    void new DemoClient().machines().then((all) => { if (live) setPC(all.find((p) => p.parts) ?? null); });
    return () => { live = false; };
  }, []);
  return pc;
}

/** The same 3D PC as Home, large and swaying slowly, on a light or graphite stage. */
function ArtPC({ tone }: { tone: "light" | "dark" }) {
  const pc = useDemoPC();
  return (
    <div className={`signin-art art-inset art-pc${tone === "dark" ? " tone-dark" : ""}`}>
      <Brand />
      <div className="art-pc-stage">{pc && <PCPreview pc={pc} className="art-pc-canvas" />}</div>
      <Copy />
    </div>
  );
}

/** A glimpse of Home itself, the first thing they'll see once signed in. */
function ArtGlimpse() {
  return (
    <div className="signin-art art-inset art-glimpse">
      <Brand />
      <Copy />
      <div className="glimpse-frame" aria-hidden="true"><img src={homeShot} alt="" draggable={false} /></div>
    </div>
  );
}

/** The 3D PC with its own switches: pulled apart, colored by heat. */
function Stage3D({ pc, exploded, heat, className }: { pc: PC; exploded?: boolean; heat?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let scene: ReturnType<typeof createScene> | null = null;
    try {
      scene = createScene(ref.current!);
      scene.setPC(pc, sceneTheme);
      scene.setZoomable(false);
      scene.setHeat(!!heat);
      scene.setSpin(true);
      if (exploded) scene.setExploded(true);
    } catch { /* no WebGL: the panel reads fine without the picture */ }
    return () => scene?.dispose();
  }, [pc, exploded, heat]);
  return <div ref={ref} className={className} aria-hidden="true" />;
}

/** The PC pulled apart, every part glowing with its own heat. */
function ArtExploded() {
  const pc = useDemoPC();
  return (
    <div className="signin-art art-inset art-exploded tone-dark">
      <Brand />
      <div className="art-pc-stage">{pc && <Stage3D pc={pc} exploded heat className="art-pc-canvas" />}</div>
      <div className="art-copy">
        <h2>Every part. <span>How hot it runs.</span></h2>
        <p>Rig takes your PC apart on screen, so you can see what's working hard.</p>
      </div>
    </div>
  );
}

const readings = [
  { name: "Processor", v: 42 },
  { name: "Graphics card", v: 71 },
  { name: "Storage", v: 39 },
  { name: "Motherboard", v: 35 },
];

/** One reading, poster size. The panel turns from brass to rust as the number climbs. */
function ArtNumber() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % readings.length), 3200);
    return () => clearInterval(t);
  }, []);
  const r = readings[i];
  return (
    <div className="signin-art art-inset art-number" data-hot={r.v >= 50 ? "" : undefined}>
      <Brand />
      <p className="number-label"><span className="number-live" />{r.name}, right now</p>
      <p className="number-big num" key={i} aria-hidden="true">{r.v}<span>°</span></p>
      <Copy />
    </div>
  );
}

const fanCols = [3, 4, 4, 5, 5, 6, 5, 5, 4, 4, 3, 3, 4, 5];

/** Home in tiles: the PC, its health, its hottest part and its fans. */
function ArtBento() {
  const pc = useDemoPC();
  const ring = 2 * Math.PI * 34;
  return (
    <div className="signin-art art-inset art-bento">
      <Brand />
      <div className="bento" aria-hidden="true">
        <div className="bt bt-pc">{pc && <PCPreview pc={pc} className="art-pc-canvas" />}<span className="bt-cap">Atlas</span></div>
        <div className="bt bt-health tone-dark">
          <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="34" /><circle className="ring" cx="42" cy="42" r="34" strokeDasharray={`${ring * 0.96} ${ring}`} /></svg>
          <b className="num">96</b>
          <span className="bt-cap">Health</span>
        </div>
        <div className="bt bt-temp">
          <b className="num">71°</b>
          <span className="bt-cap">Graphics card</span>
        </div>
        <div className="bt bt-fans">
          <div className="dots">
            {fanCols.map((h, c) => Array.from({ length: 6 }, (_, r) => <i key={`${c}-${r}`} className={5 - r < h ? "on" : undefined} style={{ "--c": c } as CSSProperties} />))}
          </div>
          <span className="bt-cap">Fans <b className="num">920</b> rpm</span>
        </div>
        <div className="bt bt-copy"><h2>See inside your PC.</h2></div>
      </div>
    </div>
  );
}
