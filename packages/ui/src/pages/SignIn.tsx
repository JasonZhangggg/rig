import { useState } from "react";
import type { Account, RigClient } from "@rig/core";
import { AsciiField, type TowerFit } from "../components/AsciiField";

const ARTS = ["tower", "big-quiet", "hero-line", "bleed", "readout", "split-caption"] as const;
type Art = (typeof ARTS)[number];

const LOOKS: Record<Art, string> = {
  tower: "", "big-quiet": "art-big-quiet", "hero-line": "art-hero-line", bleed: "art-bleed", readout: "art-readout", "split-caption": "art-split-caption",
};

const FITS: Record<Art, TowerFit | undefined> = {
  tower: undefined,
  "big-quiet": { size: 0.78, y: 0.5 },
  "hero-line": { size: 0.78, x: 0.62, y: 0.43 },
  bleed: { size: 1.3, width: 2, x: 0.76, y: 0.64 },
  readout: { size: 0.68, y: 0.5 },
  "split-caption": { size: 0.72, y: 0.42 },
};

/** Which panel layout to show, picked with ?art= so the options can be compared side by side. */
function pickArt(): Art {
  const a = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("art");
  return (ARTS as readonly string[]).includes(a ?? "") ? (a as Art) : "tower";
}

const READINGS = [
  { at: "at-tl", label: "CPU", value: "41°C", hot: false },
  { at: "at-tr", label: "GPU", value: "46°C", hot: true },
  { at: "at-bl", label: "Fans", value: "921 rpm", hot: false },
  { at: "at-br", label: "Case", value: "29°C", hot: false },
] as const;

/** The left half of sign-in screens: a PC in thermal characters that warms under the pointer. */
export function SignInArt() {
  const [art] = useState(pickArt);
  return (
    <div className={`signin-art tone-dark ${LOOKS[art]}`}>
      <AsciiField fit={FITS[art]}>
        {art === "readout" && (
          <div className="art-hud">
            {READINGS.map((r) => (
              <span key={r.at} className={`art-reading ${r.at}${r.hot ? " hot" : ""}`}><span>{r.label}</span><b className="num">{r.value}</b></span>
            ))}
          </div>
        )}
      </AsciiField>
      <div className="brand"><span className="brand-mark" />Rig</div>
      {art === "big-quiet" && <p className="art-note">See inside your PC.</p>}
      {art === "hero-line" && (
        <div className="art-copy">
          <p className="art-head">Know your PC.</p>
          <p className="art-sub">What's inside, what's wrong and what to do next.</p>
        </div>
      )}
      {art === "bleed" && <p className="art-note">Every part,<br />in plain words.</p>}
      {art === "split-caption" && (
        <div className="art-copy">
          <p className="art-head">Know what's inside your PC and what to fix next.</p>
          <p className="art-mono">Live temperatures, fixes shown first, undo anything</p>
        </div>
      )}
    </div>
  );
}

/** Sign-in for the website (email or Google) and the desktop app (a code approved in the browser). */
export function SignIn({ client, onDone, onSkip, note }: { client: RigClient; onDone: (a: Account) => void; onSkip?: () => void; note?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; url: string } | null>(null);

  const run = async (f: () => Promise<Account | void>) => {
    setBusy(true); setError(null);
    try { const a = await f(); if (a) onDone(a); } catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Try again."); } finally { setBusy(false); }
  };

  const browser = () => run(async () => {
    const s = await client.signInWithBrowser!();
    setCode({ code: s.code, url: s.url });
    return s.done;
  });

  return (
    <div className="signin">
      <SignInArt />
      <main className="signin-form">
        {client.signInWithBrowser ? (
          <div className="signin-box">
            <h1>Sign in</h1>
            <p className="muted">Signing in lets you see this PC from any browser and keeps its history and changes safe if you reinstall.</p>
            {code ? (
              <>
                <p>Your browser opened Rig's website. Check that it shows this code, then approve:</p>
                <p className="signin-code num" aria-label="Sign-in code">{code.code}</p>
                <p className="faint" style={{ fontSize: 12.5 }}>Browser didn't open? Go to <b>{code.url}</b>.</p>
              </>
            ) : (
              <button className="btn primary" type="button" disabled={busy} onClick={browser}>Sign in with your browser</button>
            )}
            {error && <div className="callout warn" role="alert">{error}</div>}
            {onSkip && <button className="btn ghost" type="button" onClick={onSkip}>Not now</button>}
          </div>
        ) : (
          <form className="signin-box" onSubmit={(e) => { e.preventDefault(); run(() => client.signInEmail!(email, password, mode === "up" ? { name: name || email.split("@")[0] } : undefined)); }}>
            <h1>{mode === "in" ? "Sign in" : "Make an account"}</h1>
            <p className="muted">{note ?? "Your PCs, their history and every change stay in sync between the app and the web."}</p>
            {mode === "up" && <div className="field"><label className="label" htmlFor="name">Your name</label><input className="input" id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>}
            <div className="field"><label className="label" htmlFor="email">Email</label><input className="input" id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div>
            <div className="field"><label className="label" htmlFor="password">Password</label><input className="input" id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} /></div>
            {error && <div className="callout warn" role="alert">{error}</div>}
            <button className="btn primary" disabled={busy}>{busy ? "One moment…" : mode === "in" ? "Sign in" : "Make my account"}</button>
            {client.signInGoogle && <><div className="or">or</div><button className="btn" type="button" disabled={busy} onClick={() => run(() => client.signInGoogle!())}>Continue with Google</button></>}
            <p className="faint" style={{ fontSize: 13 }}>
              {mode === "in" ? <>New to Rig? <button type="button" className="linkish" onClick={() => setMode("up")}>Make an account</button></> : <>Have an account? <button type="button" className="linkish" onClick={() => setMode("in")}>Sign in</button></>}
            </p>
          </form>
        )}
        {client.kind === "web" && <p className="signin-foot faint">Just looking? <a href="/app/?demo">Try the demo</a></p>}
      </main>
    </div>
  );
}
