import "@fontsource-variable/inter-tight";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { PCPreview } from "@rig/ui/preview";
import { rigVersion } from "@rig/ui/version";
import { builtDownload, latestDownload, megabytes, onWindows, type Download } from "./download";
import "./landing.css";

// The install page. The web app (your PCs, the demo, and the page the desktop app
// opens to approve its sign-in) lives at /app/ and is linked from here.

const steps: { t: string; d: string }[] = [
  { t: "Open Rig Setup", d: "Open the file you downloaded. It's in your Downloads folder." },
  { t: "Choose More info, then Run anyway", d: "Windows says “Windows protected your PC” because Rig Setup isn't code-signed yet." },
  { t: "Choose Install, then Yes", d: "Windows asks once whether Rig may make changes, so it can read your temperatures and fans." },
];

const needs: { t: string; d: string }[] = [
  { t: "Windows", d: "10 or 11, 64-bit" },
  { t: "Any PC", d: "Desktop or laptop" },
  { t: "One yes", d: "From an administrator, while installing" },
  { t: "Internet", d: "For chat, sign-in and updates" },
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

/** The demo PC from Home, turning slowly, as on the sign-in screen. */
function DemoPC() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => {
    let live = true;
    void new DemoClient().machines().then((all) => { if (live) setPC(all.find((p) => p.parts) ?? null); }, () => {});
    return () => { live = false; };
  }, []);
  return (
    <figure className="ip-pc">
      <div className="ip-pc-stage">{pc && <PCPreview pc={pc} className="ip-canvas" />}</div>
      <figcaption>{pc ? `${pc.name}, the demo PC, as Rig shows it` : " "}</figcaption>
    </figure>
  );
}

function Landing() {
  const [dl, setDL] = useState<Download>(() => builtDownload(rigVersion));
  const [started, setStarted] = useState(false);
  const windows = onWindows(navigator);
  useEffect(() => {
    const stop = new AbortController();
    void latestDownload(stop.signal).then((d) => { if (d) setDL(d); });
    return () => stop.abort();
  }, []);
  const meta = [`Version ${dl.version}`, "Windows 10 and 11, 64-bit", dl.size ? megabytes(dl.size) : null].filter(Boolean).join(" · ");
  // After the click, the page turns to what comes next, as Discord's and Spotify's do.
  const begin = () => {
    setStarted(true);
    requestAnimationFrame(() => document.getElementById("ip-install")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
  };

  return (
    <div className="ip">
      <section className="ip-hero" aria-labelledby="ip-title">
        <header className="ip-top">
          <a className="ip-logo" href="/"><img src="/rig-logo.png" alt="" width="34" height="34" />Rig</a>
          <nav aria-label="Main">
            <a className="ip-hide-sm" href="/app/?demo">Try the demo</a>
            <a className="ip-signin" href="/app/">Sign in</a>
          </nav>
        </header>

        <div className="ip-hero-copy">
          <h1 id="ip-title">See inside your&nbsp;PC.</h1>
          <p className="ip-sub">Rig shows your parts in 3D with live temperatures, explains problems in plain words, and fixes settings only when you say yes, with one-click undo. Free.</p>
          {windows ? (
            <>
              <a className="ip-btn" href={dl.url} onClick={begin}><DownloadIcon />Download for Windows</a>
              <p className="ip-meta">{meta}</p>
            </>
          ) : (
            <>
              <a className="ip-btn" href="/app/?demo">Try the demo <Arrow /></a>
              <p className="ip-meta">Rig runs on Windows PCs. Open rigpc.app on yours to install it, or <a href={dl.url} onClick={begin}>download it here</a> ({meta}).</p>
            </>
          )}
        </div>
        <DemoPC />
      </section>

      <main>
        <section className={started ? "ip-section ip-install is-started" : "ip-section ip-install"} aria-labelledby="ip-install">
          <div className="ip-head">
            <h2 id="ip-install" tabIndex={-1}>{started ? "Thanks for downloading Rig" : "Install in three steps"}</h2>
            <p>{started
              ? <>Your download should start in a moment. Then follow these steps. Didn't start? <a href={dl.url}>Download it again</a>.</>
              : "About a minute, start to finish. Rig opens when it's done and reads your PC."}</p>
          </div>
          <ol className="ip-steps">
            {steps.map((s, i) => (
              <li key={s.t}>
                <span className="ip-num" aria-hidden="true">{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
          <p className="ip-note">Rig updates itself and asks before it installs an update. To check the file, compare <code>Get-FileHash</code> in PowerShell with SHA256SUMS.txt on the <a href={dl.page}>release page</a>.</p>
        </section>

        <section className="ip-section" aria-labelledby="ip-every">
          <div className="ip-head">
            <h2 id="ip-every">One account, every PC</h2>
            <p>Sign in on each PC, then check on all of them from anywhere.</p>
          </div>
          <div className="ip-places">
            <article className="ip-place">
              <p className="ip-place-kind">On your PC</p>
              <h3>The Windows app</h3>
              <p>Live temperatures, the 3D view, chat about your parts, and fixes you approve.</p>
              <a href={dl.url} onClick={begin}>Download for Windows <Arrow /></a>
            </article>
            <article className="ip-place">
              <p className="ip-place-kind">Anywhere else</p>
              <h3>Any browser</h3>
              <p>See every PC on your account from your phone or another computer: the gaming rig, the laptop, the one at your parents' place.</p>
              <a href="/app/">Sign in <Arrow /></a>
            </article>
            <article className="ip-place">
              <p className="ip-place-kind">No account</p>
              <h3>The demo</h3>
              <p>Look around two sample PCs in your browser before you install anything.</p>
              <a href="/app/?demo">Try the demo <Arrow /></a>
            </article>
          </div>
        </section>

        <section className="ip-section" aria-labelledby="ip-needs">
          <div className="ip-head"><h2 id="ip-needs">What you need</h2></div>
          <dl className="ip-needs">
            {needs.map((n) => <div key={n.t}><dt>{n.t}</dt><dd>{n.d}</dd></div>)}
          </dl>
          <p className="ip-later">Mac and Linux aren't supported yet.</p>
        </section>
      </main>

      <footer className="ip-foot">
        <span>Rig <small>{rigVersion}</small></span>
        <a href={dl.page}>Release notes</a>
        <a href="/app/?demo">Demo</a>
        <a href="/app/">Your PCs</a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Landing /></StrictMode>);
