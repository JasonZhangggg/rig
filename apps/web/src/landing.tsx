import "@fontsource-variable/inter-tight";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AsciiArt, type AsciiArtData } from "@rig/ui/ascii";
import { rigVersion } from "@rig/ui/version";
import { builtDownload, latestDownload, megabytes, onWindows, type Download } from "./download";
import "./landing.css";

// The install page. The web app (your PCs, the demo, and the page the desktop app
// opens to approve its sign-in) lives at /app/ and is linked from here.

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 2.5v9M5 7.8 9 11.8l4-4M3 15h12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Art drawn in text characters, loaded after the page so it doesn't hold up the button. */
function Art({ load, className }: { load: () => Promise<{ default: unknown }>; className: string }) {
  const [art, setArt] = useState<AsciiArtData | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((m) => { if (live) setArt(m.default as AsciiArtData); }, () => {});
    return () => { live = false; };
  }, [load]);
  return art ? <AsciiArt art={art} className={className} /> : <div className={`ascii-art ${className}`} aria-hidden="true" />;
}
const fans = () => import("./art/fans.json");
const board = () => import("./art/board.json");

/** Fades a block in the first time it scrolls into view. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || calm() || typeof IntersectionObserver === "undefined") return;
    el.classList.add("ip-hide");
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { el.classList.remove("ip-hide"); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

// --- The five things in the app, each with a small example to try. The numbers are made up. ---

function Readings() {
  const [v, setV] = useState([49, 860, 27]);
  useEffect(() => {
    if (calm()) return;
    const lim = [[44, 56], [780, 960], [12, 48]] as const;
    const t = setInterval(() => setV((old) => old.map((n, k) => {
      const [lo, hi] = lim[k]!;
      return Math.min(hi, Math.max(lo, n + (Math.random() - 0.5) * (hi - lo) * 0.18));
    })), 1400);
    return () => clearInterval(t);
  }, []);
  const [cpu, fan, load] = v as [number, number, number];
  const cells = [
    { n: `${Math.round(cpu)}°C`, l: "Processor", w: cpu },
    { n: String(Math.round(fan / 10) * 10), l: "Fan, rpm", w: fan / 20 },
    { n: `${Math.round(load)}%`, l: "Load", w: load },
  ];
  return (
    <div className="ip-toy">
      <small>Example readings</small>
      <div className="ip-reads">
        {cells.map((c) => <div key={c.l}><b>{c.n}</b><span>{c.l}</span><i style={{ ["--w" as string]: `${c.w}%` }} /></div>)}
      </div>
    </div>
  );
}

const partTemps: [string, string][] = [["Processor", "49°C"], ["Graphics card", "50°C"], ["Storage", "42°C"], ["Motherboard", "37°C"]];
function Parts() {
  const [pick, setPick] = useState(0);
  const [name, temp] = partTemps[pick]!;
  return (
    <div className="ip-toy">
      <small>Pick a part</small>
      <div className="ip-parts">
        {partTemps.map(([p], i) => <button key={p} type="button" aria-pressed={i === pick} onClick={() => setPick(i)}>{p}</button>)}
        <p aria-live="polite">{name}: {temp}</p>
      </div>
    </div>
  );
}

function series(seed: number, n: number, base: number, amp: number) {
  let s = seed, v = base;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    v += (s / 2147483647 - 0.5) * amp;
    v = Math.min(95, Math.max(15, v + (base - v) * 0.08));
    out.push(v);
  }
  return out;
}
const ranges: [string, string, number[]][] = [["5 min", "5 minutes", series(7, 60, 48, 9)], ["1 hour", "an hour", series(23, 60, 52, 14)], ["Day", "a day", series(91, 60, 45, 22)]];
function Log() {
  const [r, setR] = useState(0);
  const line = useRef<SVGPathElement>(null);
  const W = 440, H = 110;
  const [, span, data] = ranges[r]!;
  const d = `M${data.map((v, i, a) => `${((i / (a.length - 1)) * W).toFixed(1)} ${(H - 6 - ((v - 15) / 80) * (H - 12)).toFixed(1)}`).join(" L")}`;
  useEffect(() => {
    const l = line.current;
    if (!l || calm() || !l.getTotalLength) return;
    const len = l.getTotalLength();
    l.style.transition = "none"; l.style.strokeDasharray = `${len}`; l.style.strokeDashoffset = `${len}`;
    void l.getBoundingClientRect();
    l.style.transition = "stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)"; l.style.strokeDashoffset = "0";
  }, [r]);
  return (
    <div className="ip-toy">
      <div className="ip-ranges">{ranges.map(([n], i) => <button key={n} type="button" aria-pressed={i === r} onClick={() => setR(i)}>{n}</button>)}</div>
      <svg className="ip-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Example processor temperature over ${span}`}>
        <path className="ip-area" d={`${d} L${W} ${H} L0 ${H} Z`} /><path ref={line} className="ip-line" d={d} />
      </svg>
      <small className="ip-under">Example processor temperature</small>
    </div>
  );
}

const questions = ["Which of my startup apps can I safely turn off?", "Why is my PC loud?", "Where do the front panel cables plug in?"];
function Ask() {
  const [qi, setQi] = useState(0);
  const [shown, setShown] = useState(questions[0]!);
  useEffect(() => {
    const q = questions[qi]!;
    if (calm()) { setShown(q); return; }
    let n = 0;
    setShown("");
    const t = setInterval(() => { n++; setShown(q.slice(0, n)); if (n >= q.length) clearInterval(t); }, 38);
    return () => clearInterval(t);
  }, [qi]);
  return (
    <div className="ip-toy">
      <small>Questions people ask</small>
      <div className="ip-field">
        <span className="ip-q">{shown}</span>
        <button type="button" onClick={() => setQi((qi + 1) % questions.length)}>Next</button>
      </div>
    </div>
  );
}

function Change() {
  const [done, setDone] = useState(false);
  return (
    <div className="ip-toy">
      <small>Example change</small>
      <div className="ip-chg">
        <div>Turn off an app at startup<span className={done ? "ip-st" : undefined} aria-live="polite">{done ? "Approved. Undo puts it back." : "Waiting for you"}</span></div>
        <button className="ip-btn ip-btn-sm" type="button" onClick={() => setDone(!done)}>{done ? "Undo" : "Approve"}</button>
      </div>
    </div>
  );
}

const features: { tab: string; shot: string; alt: string; title: string; text: string; toy: () => ReactNode }[] = [
  { tab: "Readings", shot: "home", alt: "Rig's Home screen", title: "Temperatures, fans and load", text: "Each part's temperature, fan speed and load, updating while Rig is open.", toy: () => <Readings /> },
  { tab: "Parts", shot: "pc", alt: "Rig's My PC screen with the PC in 3D", title: "Your PC in 3D", text: "A 3D model of your PC with each part labeled. Pick a part to see its readings.", toy: () => <Parts /> },
  { tab: "Logs", shot: "logs", alt: "Rig's Logs screen", title: "Logs", text: "Rig saves your readings, so you can look back at anything from the last five minutes to the last month.", toy: () => <Log /> },
  { tab: "Ask", shot: "ask", alt: "Rig's Ask screen", title: "Ask about your parts", text: "Type a question about your PC, like why it's loud, and Rig answers.", toy: () => <Ask /> },
  { tab: "Changes", shot: "changes", alt: "Rig's Changes screen", title: "Changes need your OK", text: "Rig changes a setting only after you approve it, and you can undo it.", toy: () => <Change /> },
];

/** A window of the app beside the list. Whichever item is mid-screen picks the screenshot. */
function Story() {
  const [cur, setCur] = useState(0);
  const steps = useRef<(HTMLElement | null)[]>([]);
  const story = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const intro = useReveal<HTMLDivElement>();
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) setCur(steps.current.indexOf(e.target as HTMLElement));
    }), { rootMargin: "-45% 0px -45% 0px" });
    steps.current.forEach((s) => s && io.observe(s));
    let frame = 0;
    const fill = () => {
      frame = 0;
      const r = story.current?.getBoundingClientRect();
      if (!r || !rail.current) return;
      const p = Math.min(1, Math.max(0, (innerHeight / 2 - r.top) / r.height)) * features.length;
      [...rail.current.children].forEach((b, k) => (b as HTMLElement).style.setProperty("--p", `${Math.min(100, Math.max(0, (p - k) * 100))}%`));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(fill); };
    addEventListener("scroll", onScroll, { passive: true });
    fill();
    return () => { io.disconnect(); removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);
  const go = (k: number) => steps.current[k]?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
  return (
    <section className="ip-story ip-gut" ref={story} aria-labelledby="ip-in">
      <div className="ip-wrap">
        <div className="ip-intro" ref={intro}><h2 id="ip-in">What's in the app</h2><p>The numbers on this page are examples.</p></div>
        <div className="ip-sgrid">
          <div className="ip-stage">
            <div className="ip-win">
              {features.map((f, k) => <img key={f.shot} className={k === cur ? "on" : undefined} src={`/shots/${f.shot}.jpg`} alt={k === cur ? f.alt : ""} width="1440" height="900" loading={k ? "lazy" : undefined} />)}
            </div>
            <div className="ip-rail" ref={rail}>
              {features.map((f, k) => <button key={f.tab} type="button" className={k === cur ? "on" : undefined} onClick={() => go(k)}>{f.tab}</button>)}
            </div>
          </div>
          <div className="ip-steps">
            {features.map((f, k) => (
              <article key={f.tab} ref={(el) => { steps.current[k] = el; }} className={k === cur ? "ip-step on" : "ip-step"}>
                <img className="ip-shot" src={`/shots/${f.shot}.jpg`} alt="" width="1440" height="900" loading="lazy" />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                {f.toy()}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const ticker = [["Processor", "49°C"], ["Fan", "860 rpm"], ["Load", "27%"], ["Graphics card", "50°C"], ["Storage", "42°C"], ["Motherboard", "37°C"]];
function Ticker() {
  const run = (hidden: boolean) => (
    <div aria-hidden={hidden || undefined}>
      <span className="ip-tick-label">Example readings</span>
      {ticker.map(([k, v]) => <span key={k}>{k} <em>{v}</em></span>)}
    </div>
  );
  return <div className="ip-tick">{run(false)}{run(true)}</div>;
}

function Questions({ dl }: { dl: Download }) {
  const head = useReveal<HTMLHeadingElement>();
  const list = useReveal<HTMLDivElement>();
  return (
    <section className="ip-gut" aria-labelledby="ip-qa">
      <div className="ip-wrap ip-qa">
        <h2 id="ip-qa" ref={head}>Questions</h2>
        <div ref={list}>
          <details open><summary>Why does it need admin rights?</summary><p>To read the temperature and fan sensors. Windows asks once, while Rig installs.</p></details>
          <details><summary>Which PCs does it run on?</summary><p>Windows 10 and 11, 64-bit, desktop or laptop. Mac and Linux aren't supported yet.</p></details>
          <details><summary>Does it cost anything?</summary><p>No, Rig is free.</p></details>
          <details><summary>Can I try it first?</summary><p>Yes. <a href="/app/?demo">The demo</a> runs in your browser with two sample PCs.</p></details>
          <details><summary>How does it update?</summary><p>Rig checks for updates and asks before it installs one.</p></details>
          <details><summary>How do I check the file?</summary><p>Run <code>Get-FileHash</code> in PowerShell on Rig Setup and compare it with SHA256SUMS.txt on the <a href={dl.page}>release page</a>.</p></details>
        </div>
      </div>
    </section>
  );
}

function Landing() {
  const [dl, setDL] = useState<Download>(() => builtDownload(rigVersion));
  const [started, setStarted] = useState(false);
  const windows = onWindows(navigator);
  const endHead = useReveal<HTMLHeadingElement>();
  useEffect(() => {
    const stop = new AbortController();
    void latestDownload(stop.signal).then((d) => { if (d) setDL(d); });
    return () => stop.abort();
  }, []);
  const meta = ["Free", `Version ${dl.version}`, "Windows 10 and 11, 64-bit", dl.size ? megabytes(dl.size) : null].filter(Boolean).join(" · ");
  // After the click, the top of the page says what to do with the file.
  const begin = () => {
    setStarted(true);
    requestAnimationFrame(() => document.getElementById("ip-title")?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" }));
  };
  const button = <a className="ip-btn" href={dl.url} onClick={begin}><DownloadIcon />Download for Windows</a>;

  return (
    <div className="ip">
      <header className="ip-top ip-gut">
        <a className="ip-logo" href="/"><img src="/rig-logo.png" alt="" width="30" height="30" />Rig</a>
        <nav aria-label="Main">
          <a className="ip-hide-sm" href="/app/?demo">Try the demo</a>
          <a className="ip-signin" href="/app/">Sign in</a>
        </nav>
      </header>

      <section className="ip-hero ip-gut" aria-labelledby="ip-title">
        <h1 id="ip-title" tabIndex={-1}>{started ? "Thanks for downloading Rig" : "Rig for Windows"}</h1>
        {started ? (
          <p className="ip-lede">Open Rig Setup from your Downloads folder, then choose Install. Rig opens when it's done. Didn't start? <a href={dl.url}>Download it again</a>.</p>
        ) : (
          <p className="ip-lede">Rig shows your PC's temperatures, fan speeds and load, saves them so you can look back, and answers questions about your parts. It changes a setting only after you approve it.</p>
        )}
        {windows ? (
          <>
            {!started && <div className="ip-ctas">{button}<a className="ip-ghost" href="/app/?demo">Try the demo</a></div>}
            <p className="ip-meta">{meta}</p>
          </>
        ) : (
          <>
            <div className="ip-ctas"><a className="ip-btn" href="/app/?demo">Try the demo</a></div>
            <p className="ip-meta">Rig runs on Windows PCs. Open rigpc.app on yours to install it, or <a href={dl.url} onClick={begin}>download it here</a> ({meta}).</p>
          </>
        )}
      </section>

      <div className="ip-gut">
        <div className="ip-band">
          <Art load={fans} className="ip-band-art" />
          <img src="/shots/home.jpg" alt="Rig's Home screen with the demo PC's readings" width="1440" height="900" />
        </div>
      </div>

      <main>
        <Story />
        <Ticker />
        <Questions dl={dl} />
      </main>

      <section className="ip-end" aria-labelledby="ip-get">
        <Art load={board} className="ip-end-art" />
        <div className="ip-end-copy ip-gut">
          <div className="ip-wrap">
            <h2 id="ip-get" ref={endHead}>Download Rig</h2>
            <p>{meta}</p>
            {windows ? button : <a className="ip-btn" href="/app/?demo">Try the demo</a>}
          </div>
        </div>
      </section>

      <footer className="ip-foot ip-gut">
        <span>Rig <small>{rigVersion}</small></span>
        <nav aria-label="More">
          <a href={dl.page}>Release notes</a>
          <a href="/app/?demo">Demo</a>
          <a href="/app/">Your PCs</a>
        </nav>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Landing /></StrictMode>);
