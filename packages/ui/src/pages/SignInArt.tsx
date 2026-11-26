import { useEffect, useRef } from "react";
import { AsciiField } from "../components/AsciiField";
import { reducedMotion } from "../appearance";

/** Preview only: the left half of the sign-in screens in a few calmer looks. Pick one with ?art=pulse, lines or drawing. */
type Art = "ascii" | "pulse" | "lines" | "drawing";
const arts: Art[] = ["ascii", "pulse", "lines", "drawing"];

function pickArt(): Art {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("art");
  return arts.includes(v as Art) ? (v as Art) : "ascii";
}

export function SignInArt() {
  const art = pickArt();
  if (art === "pulse") return <ArtPulse />;
  if (art === "lines") return <ArtLines />;
  if (art === "drawing") return <ArtDrawing />;
  return (
    <div className="signin-art tone-dark">
      <AsciiField fit={{ size: 0.78 }} />
      <div className="brand"><span className="brand-mark" />Rig</div>
      <p className="art-note">See inside your PC.</p>
    </div>
  );
}

const Brand = () => <div className="brand"><span className="brand-mark" />Rig</div>;

/** The Rig mark, large and alone, its dot breathing like a sleeping PC's power light. */
function ArtPulse() {
  return (
    <div className="signin-art art-pulse tone-dark">
      <div className="pulse-stage">
        <div className="pulse-mark" aria-hidden="true">
          <span className="pulse-r">R</span>
          <span className="pulse-dot" />
        </div>
        <h2 className="pulse-title">See inside your PC.</h2>
        <p className="pulse-sub">Every part, how warm it runs, and what to fix.</p>
      </div>
    </div>
  );
}

type Lane = { name: string; unit: string; base: number; waves: [number, number, number][]; tone: "good" | "expected" | "text" };
const lanes: Lane[] = [
  { name: "Processor", unit: "°", base: 43, waves: [[5, 0.11, 0.4], [2.2, 0.31, 2.1], [0.8, 0.83, 4]], tone: "good" },
  { name: "Graphics card", unit: "°", base: 49, waves: [[4, 0.07, 1.3], [2.6, 0.23, 5.2], [0.9, 0.71, 0.6]], tone: "text" },
  { name: "Fans", unit: " rpm", base: 910, waves: [[55, 0.09, 3.3], [22, 0.27, 0.9], [9, 0.67, 2.4]], tone: "expected" },
];
const SPAN = 60, STEP = 0.5, W = 600, H = 72;
const valueAt = (l: Lane, t: number) => l.waves.reduce((v, [a, f, p]) => v + a * Math.sin(t * f + p), l.base);
const rangeOf = (l: Lane) => l.waves.reduce((s, [a]) => s + a, 0) * 1.25;

/** Three readings drawn as slow, live lines, the way Rig's Readings page shows them. */
function ArtLines() {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  const values = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const start = 400;
    let raf = 0;
    const shown = lanes.map(() => "");
    const draw = (now: number) => {
      const t = start + now / 1000;
      lanes.forEach((l, i) => {
        const r = rangeOf(l), y = (v: number) => H / 2 - ((v - l.base) / r) * (H / 2);
        let d = "";
        for (let s = 0; s <= SPAN; s += STEP) d += `${s ? "L" : "M"}${((s / SPAN) * W).toFixed(1)} ${y(valueAt(l, t - SPAN + s)).toFixed(2)}`;
        paths.current[i]?.setAttribute("d", d);
        const v = valueAt(l, t);
        const dot = dots.current[i];
        if (dot) dot.style.transform = `translateY(${y(v) - H / 2}px)`;
        const text = l.unit === "°" ? `${Math.round(v)}°` : `${Math.round(v / 10) * 10}`;
        if (text !== shown[i] && values.current[i]) { values.current[i]!.textContent = text; shown[i] = text; }
      });
      if (!reducedMotion()) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="signin-art art-lines tone-dark">
      <Brand />
      <div className="lines-stage" aria-hidden="true">
        {lanes.map((l, i) => (
          <div key={l.name} className="line-lane" data-tone={l.tone}>
            <div className="line-head">
              <span className="line-name">{l.name}</span>
              <span className="line-value num"><span ref={(e) => { values.current[i] = e; }} />{l.unit === " rpm" && <small> rpm</small>}</span>
            </div>
            <div className="line-plot">
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><path ref={(e) => { paths.current[i] = e; }} vectorEffect="non-scaling-stroke" /></svg>
              <span className="line-dot" ref={(e) => { dots.current[i] = e; }} />
            </div>
          </div>
        ))}
      </div>
      <p className="art-note">See inside your PC.</p>
    </div>
  );
}

/** A side view of a PC as an ink drawing, with the cooler's fan turning slowly. */
function ArtDrawing() {
  const fins = Array.from({ length: 25 }, (_, i) => 84 + i * 10);
  const grille = Array.from({ length: 9 }, (_, i) => 60 + i * 9);
  const blades = Array.from({ length: 5 }, (_, i) => i * 72);
  const label = (y: number, name: string, value: string | null, side: "l" | "r", from: [number, number], via?: [number, number]) => {
    const tx = side === "l" ? -22 : 482;
    const end = side === "l" ? -12 : 472;
    const pts = [from, ...(via ? [via] : []), [end, y]].map((p) => p.join(",")).join(" ");
    return (
      <g className="dr-label">
        <polyline points={pts} />
        <circle cx={from[0]} cy={from[1]} r="3" />
        <text x={tx} y={y + 5} textAnchor={side === "l" ? "end" : "start"}>
          <tspan className="dr-name">{name}</tspan>
          {value && <tspan className="dr-val" dx="8">{value}</tspan>}
        </text>
      </g>
    );
  };
  return (
    <div className="signin-art art-drawing">
      <Brand />
      <svg className="drawing" viewBox="-176 6 820 500" role="img" aria-label="A drawing of the inside of a PC">
        {/* Case and feet */}
        <rect className="dr-case" x="20" y="20" width="420" height="470" rx="16" />
        <rect className="dr-thin" x="32" y="32" width="396" height="446" rx="8" />
        <rect className="dr-foot" x="62" y="490" width="56" height="9" rx="3" />
        <rect className="dr-foot" x="342" y="490" width="56" height="9" rx="3" />
        {/* Motherboard */}
        <rect className="dr-board" x="60" y="56" width="250" height="300" rx="6" />
        {[[72, 68], [298, 68], [72, 344], [298, 344], [185, 68], [185, 344]].map(([x, y]) => <circle key={`${x}-${y}`} className="dr-hole" cx={x} cy={y} r="3" />)}
        {/* Memory */}
        {[244, 255, 266, 277].map((x) => <rect key={x} className="dr-part" x={x} y="98" width="7" height="112" rx="2" />)}
        {/* Processor cooler with its fan */}
        <rect className="dr-part warm" x="120" y="96" width="110" height="110" rx="14" />
        <g transform="translate(175 151)">
          <g className="dr-fan">
            <circle className="dr-ring" r="45" />
            {blades.map((a) => <path key={a} className="dr-blade" transform={`rotate(${a})`} d="M-2 -11.5 C 10 -15 22 -24 27 -38 C 18 -44 4 -42 -6 -33 C -9 -25 -7 -16 -2 -11.5 Z" />)}
            <circle className="dr-hub" r="11" />
          </g>
        </g>
        {/* Graphics card */}
        <rect className="dr-bracket" x="34" y="228" width="9" height="76" rx="2" />
        <rect className="dr-part warm" x="43" y="236" width="312" height="58" rx="9" />
        {fins.map((x) => <line key={x} className="dr-fin" x1={x} y1="250" x2={x} y2="276" />)}
        <line className="dr-thin" x1="58" y1="286" x2="340" y2="286" />
        {/* Storage */}
        <rect className="dr-part" x="112" y="318" width="76" height="14" rx="3" />
        {/* Front fans, seen edge on */}
        {[78, 168, 258].map((y) => (
          <g key={y}>
            <rect className="dr-part" x="400" y={y} width="18" height="80" rx="3" />
            <line className="dr-fin" x1="409" y1={y + 8} x2="409" y2={y + 72} />
          </g>
        ))}
        {/* Shroud, power supply and its cables */}
        <line className="dr-thin" x1="32" y1="398" x2="428" y2="398" />
        <rect className="dr-part" x="46" y="410" width="156" height="66" rx="6" />
        {grille.map((x) => <line key={x} className="dr-fin" x1={x} y1="422" x2={x} y2="464" />)}
        <path className="dr-cable" d="M196 410 C 214 382 312 384 304 330" />
        <path className="dr-cable" d="M182 410 C 186 360 120 300 118 296" />
        {/* Labels */}
        {label(151, "Processor", "42°", "l", [120, 151])}
        {label(265, "Graphics card", "46°", "l", [43, 265])}
        {label(325, "Storage", "39°", "l", [112, 325])}
        {label(443, "Power supply", null, "l", [46, 443])}
        {label(52, "Memory", null, "r", [262, 98], [262, 52])}
        {label(208, "Front fans", "910 rpm", "r", [418, 208])}
      </svg>
      <p className="art-note">See inside your PC.</p>
    </div>
  );
}
