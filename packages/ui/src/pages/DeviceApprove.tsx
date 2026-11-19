import { useState } from "react";
import type { Account, RigClient } from "@rig/core";
import { SignInArt } from "./SignIn";

/** Website: the desktop app opened this page with its sign-in code. The person checks the code and approves. */
export function DeviceApprove({ client, account, code, onClose }: { client: RigClient; account: Account; code: string; onClose: () => void }) {
  const [state, setState] = useState<"ask" | "busy" | "approved" | "denied">("ask");
  const [error, setError] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    setState("busy"); setError(null);
    try { await client.approveDevice!(code, approve); setState(approve ? "approved" : "denied"); } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again."); setState("ask");
    }
  };
  return (
    <div className="signin">
      <SignInArt />
      <main className="signin-form">
        <div className="signin-box">
          {state === "approved" ? (
            <>
              <h1>PC signed in</h1>
              <p className="muted">Rig on that PC is signed in as {account.email}. You can close this tab.</p>
              <button className="btn primary" type="button" onClick={onClose}>See your PCs</button>
            </>
          ) : state === "denied" ? (
            <>
              <h1>Sign-in denied</h1>
              <p className="muted">That PC stays signed out. There's nothing else to do.</p>
              <button className="btn" type="button" onClick={onClose}>See your PCs</button>
            </>
          ) : (
            <>
              <h1>Approve this sign-in?</h1>
              <p className="muted">Rig on a PC wants to sign in as <b>{account.email}</b>. Approve only if the app shows this code.</p>
              <p className="signin-code num" aria-label="Sign-in code">{code}</p>
              {error && <div className="callout warn" role="alert">{error}</div>}
              <button className="btn primary" type="button" disabled={state === "busy"} onClick={() => decide(true)}>{state === "busy" ? "Approving…" : "Approve"}</button>
              <button className="btn ghost" type="button" disabled={state === "busy"} onClick={() => decide(false)}>That wasn't me</button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
