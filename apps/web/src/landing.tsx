import "@fontsource-variable/inter-tight";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { PCPreview } from "@rig/ui/preview";
import { rigVersion } from "@rig/ui/version";
import { builtDownload, latestDownload, megabytes, type Download } from "./download";
import "./landing.css";

// The install page. The web app (your PCs, the demo, and the page the desktop app
// opens to approve its sign-in) lives at /app/ and is linked from here.

const steps: { t: string; d: string }[] = [
  { t: "Open Rig Setup", d: "Open the file you downloaded. It's in your Downloads folder." },
  { t: "Get past the blue warning", d: "If Windows says “Windows protected your PC”, choose More info, then Run anyway. Rig Setup isn't code-signed yet, so Windows doesn't recognize it." },
  { t: "Choose Install, then Yes", d: "When Windows asks whether Rig may make changes, choose Yes. Rig needs it once, to read your temperatures and fans in the background." },
  { t: "Rig opens", d: "It reads your PC and shows it in 3D. Sign in if you'd like to see it from any browser." },
];

const needs: { t: string; d: string }[] = [
  { t: "Windows", d: "Windows 10 or 11, 64-bit" },
  { t: "Your PC", d: "Any desktop or laptop" },
  { t: "Permission", d: "An administrator's yes, once, while installing" },
  { t: "Internet", d: "For chat, sign-in and updates" },
  { t: "Mac and Linux", d: "Not yet. You can see your PCs from any browser." },
];

function Arrow() {
  return (
    <svg className="ip-arrow" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 7h9.5M7.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 2.5v9M5 7.8 9 11.8l4-4M3 15h12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The demo PC from Home, turning slowly on graphite, as on the sign-in screen. */
function Art() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => {
    let live = true;
    void new DemoClient().machines().then((all) => { if (live) setPC(all.find((p) => p.parts) ?? null); }, () => {});
    return () => { live = false; };
  }, []);
  return (
    <aside className="ip-art" aria-label="Rig's 3D view of a PC">
      <div className="ip-pc">{pc && <PCPreview pc={pc} className="ip-canvas" />}</div>
      <p className="ip-art-cap">{pc ? `${pc.name}, the demo PC, as Rig shows it` : " "}</p>
    </aside>
  );
}

function Landing() {
  const [dl, setDL] = useState<Download>(() => builtDownload(rigVersion));
  useEffect(() => {
    const stop = new AbortController();
    void latestDownload(stop.signal).then((d) => { if (d) setDL(d); });
    return () => stop.abort();
  }, []);
  const meta = [`Version ${dl.version}`, "Windows 10 and 11, 64-bit", dl.size ? megabytes(dl.size) : null].filter(Boolean).join(" · ");

  return (
    <div className="ip">
      <Art />
      <div className="ip-main">
        <header className="ip-top">
          <a className="ip-logo" href="/"><img src="/rig-logo.png" alt="" width="34" height="34" />Rig</a>
          <nav aria-label="Main">
            <a className="ip-hide-sm" href="/app/?demo">Try the demo</a>
            <a className="ip-nav-strong" href="/app/">Sign in <Arrow /></a>
          </nav>
        </header>

        <main>
          <section className="ip-hero" aria-labelledby="ip-title">
            <p className="ip-label">Free for Windows</p>
            <h1 id="ip-title">See inside your PC.</h1>
            <p className="ip-sub">Rig shows your parts in 3D with live temperatures, explains problems in plain words, and fixes settings only when you say yes, with one-click undo.</p>
            <a className="ip-btn" href={dl.url}><DownloadIcon />Download for Windows</a>
            <p className="ip-meta">{meta}</p>
            <p className="ip-alt">Not on Windows right now? <a href="/app/?demo">Try the demo in your browser</a></p>
          </section>

          <section className="ip-section" aria-labelledby="ip-install">
            <h2 id="ip-install">Install in a minute</h2>
            <ol className="ip-steps">
              {steps.map((s, i) => (
                <li key={s.t}>
                  <span className="ip-num" aria-hidden="true">{i + 1}</span>
                  <div><h3>{s.t}</h3><p>{s.d}</p></div>
                </li>
              ))}
            </ol>
            <p className="ip-note">Rig checks for updates by itself and asks before it installs one. To check the file, compare <code>Get-FileHash</code> in PowerShell with SHA256SUMS.txt on the <a href={dl.page}>release page</a>.</p>
          </section>

          <section className="ip-section" aria-labelledby="ip-needs">
            <h2 id="ip-needs">What you need</h2>
            <dl className="ip-needs">
              {needs.map((n) => <div key={n.t}><dt>{n.t}</dt><dd>{n.d}</dd></div>)}
            </dl>
          </section>
        </main>

        <footer className="ip-foot">
          <span>Rig <small>{rigVersion}</small></span>
          <a href={dl.page}>Release notes</a>
          <a href="/app/?demo">Demo</a>
          <a href="/app/">Your PCs</a>
        </footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Landing /></StrictMode>);
