import { useState } from "react";
import type { Account, RigClient } from "@rig/core";
import { AsciiField } from "../components/AsciiField";

/** The left half of sign-in screens: a PC in thermal characters that warms under the pointer. */
export function SignInArt() {
  return (
    <div className="signin-art tone-dark">
      <AsciiField />
      <div className="brand"><span className="brand-mark" />Rig</div>
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
