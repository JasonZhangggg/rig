import "@fontsource-variable/inter-tight";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { PCPreview } from "@rig/ui/preview";
import { rigVersion } from "@rig/ui/version";
import "./landing.css";

// Set VITE_DOWNLOAD_URL when the Windows installer has a home (for example a
// GitHub release). Until then the page says the app is in testing.
const download = import.meta.env.VITE_DOWNLOAD_URL as string | undefined;

const features = [
  { t: "See inside, in 3D", d: "Your actual parts with live temperatures. Click a part for its specs, manual and drivers, or pull the case apart." },
  { t: "Health in plain words", d: "Temperatures, storage, startup apps, drivers and battery, with what matters and why." },
  { t: "Fixes you approve", d: "Every change shows the value now and the value after. Nothing happens until you say yes, and Undo is one tap." },
  { t: "Answers from your manuals", d: "Ask why it's loud or what to upgrade. Rig answers from your parts' manuals and maker pages, and shows its sources." },
  { t: "Smoother games", d: "Frame rates measured with PresentMon, the tool game studios use. Rig never touches the game, so anti-cheat is happy." },
  { t: "All your PCs, anywhere", d: "Check every PC from the web: the gaming rig, the laptop, the one at your parents' place." },
];

const promises = [
  "Rig only changes settings from a short list it knows how to undo.",
  "It saves the old values first, and keeps a log of every change.",
  "It never installs drivers or overclocks. It links you to the maker's page instead.",
  "Readings come from LibreHardwareMonitor, an open source sensor library.",
];

const n = (i: number) => String(i + 1).padStart(2, "0");

function Arrow() {
  return (
    <svg className="lp-arrow" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 7h9.5M7.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

function Landing() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => { new DemoClient().machines().then((all) => setPC(all.find((p) => p.parts) ?? null)); }, []);
  return (
    <div className="lp">
      <header className="lp-top">
        <a className="lp-logo" href="/"><span aria-hidden="true">R</span>Rig</a>
        <nav aria-label="Main">
          <a className="lp-hide-sm" href="#features">Features</a>
          <a className="lp-hide-sm" href="#safe">Safety</a>
          <a className="lp-link" href="/app/">Sign in <Arrow /></a>
        </nav>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-text">
            <p className="lp-label">Free, for gaming rigs and laptops</p>
            <h1 id="lp-title">Know what's going on inside your PC.</h1>
            <p className="lp-sub">Rig watches your temperatures, explains problems in plain words and fixes settings for you, always with your yes and one-tap undo.</p>
            <div className="lp-cta">
              <a className="lp-btn" href="/app/?demo">Try the demo <Arrow /></a>
              {download && <a className="lp-link" href={download}>Download for Windows <Arrow /></a>}
            </div>
            <p className="lp-status">
              {download
                ? "Windows 10 and 11. The web app works on any device."
                : "Windows app: in testing. The web app works on any device."}
            </p>
          </div>
          <figure className="lp-stage">
            {pc && <PCPreview pc={pc} className="lp-canvas" />}
            {pc && <figcaption>{pc.name}, the demo PC</figcaption>}
          </figure>
        </section>

        <section id="features" className="lp-section" aria-labelledby="lp-features">
          <div className="lp-section-head">
            <p className="lp-label">What Rig does</p>
            <h2 id="lp-features">Everything about your PC, in one place.</h2>
          </div>
          <ol className="lp-features">
            {features.map((f, i) => (
              <li key={f.t}>
                <span className="lp-num">{n(i)}</span>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="safe" className="lp-section" aria-labelledby="lp-safe">
          <div className="lp-section-head">
            <p className="lp-label">Safety</p>
            <h2 id="lp-safe">Careful with your PC.</h2>
            <p>Rig asks before it changes anything, and every change can be undone.</p>
          </div>
          <ol className="lp-promises">
            {promises.map((p, i) => <li key={p}><span className="lp-num">{n(i)}</span><span>{p}</span></li>)}
          </ol>
        </section>

        <section className="lp-end" aria-label="Try Rig">
          <p>See it on a sample PC first. No sign in needed.</p>
          <a className="lp-btn" href="/app/?demo">Try the demo <Arrow /></a>
        </section>
      </main>

      <footer className="lp-foot">
        <span>Rig <small>{rigVersion}</small></span>
        <a href="/app/?demo">Demo</a>
        <a href="/app/">Your PCs</a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Landing /></StrictMode>);
