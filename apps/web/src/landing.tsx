import "@fontsource-variable/inter-tight";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { PCPreview } from "@rig/ui/preview";
import "./landing.css";

// Set VITE_DOWNLOAD_URL when the Windows installer has a home (for example a
// GitHub release). Until then the button explains that the app is in testing.
const download = import.meta.env.VITE_DOWNLOAD_URL as string | undefined;

const features = [
  { t: "See inside, in 3D", d: "Your actual parts, with live temperatures. Click a part to see its specs, manual and drivers, or pull the case apart." },
  { t: "Health in plain words", d: "Rig checks temperatures, storage, startup apps, drivers and battery, and tells you what matters and why." },
  { t: "Fixes you approve", d: "Every change shows the value now and the value after. Nothing happens until you say yes, and Undo is one tap." },
  { t: "Answers from your manuals", d: "Ask why it's loud or what to upgrade. Rig answers from your parts' manuals and maker pages, and shows its sources." },
  { t: "Smoother games", d: "Frame rates measured with PresentMon, the tool game studios use. Rig never touches the game itself, so anti-cheat is happy." },
  { t: "All your PCs, anywhere", d: "Sign in and check every PC from the web: the gaming rig, the laptop, the one at your parents' place." },
];

function Landing() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => { new DemoClient().machines().then((all) => setPC(all.find((p) => p.parts) ?? null)); }, []);
  return (
    <div className="lp">
      <header className="lp-top">
        <a className="lp-logo" href="/"><span>R</span>Rig</a>
        <nav><a href="#features">Features</a><a href="#safe">Safety</a><a className="lp-btn ghost" href="/app/">Sign in</a></nav>
      </header>

      <section className="lp-hero">
        <div>
          <h1>Know what's going on <em>inside your PC.</em></h1>
          <p>Rig watches your temperatures, explains problems in plain words, and fixes settings for you, always with your yes and one-tap undo. Free, for gaming rigs and laptops alike.</p>
          <div className="lp-cta">
            {download
              ? <a className="lp-btn" href={download}>Download for Windows</a>
              : <span className="lp-btn disabled" aria-disabled="true">Windows app in testing</span>}
            <a className="lp-btn ghost" href="/app/?demo">Try the demo</a>
          </div>
          <small>Windows 10 and 11. The web app works on any device.</small>
        </div>
        <div className="lp-stage">{pc && <PCPreview pc={pc} className="lp-canvas" />}</div>
      </section>

      <section id="features" className="lp-grid">
        {features.map((f) => <article key={f.t}><h2>{f.t}</h2><p>{f.d}</p></article>)}
      </section>

      <section id="safe" className="lp-safe">
        <h2>Careful with your PC</h2>
        <ul>
          <li>Rig only changes settings from a short list it knows how to undo.</li>
          <li>It saves the old values first, and keeps a log of every change.</li>
          <li>It never installs drivers or overclocks. It links you to the maker's page instead.</li>
          <li>Readings come from LibreHardwareMonitor, an open source sensor library.</li>
        </ul>
      </section>

      <footer className="lp-foot"><span>Rig</span><a href="/app/?demo">Demo</a><a href="/app/">Your PCs</a></footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Landing /></StrictMode>);
