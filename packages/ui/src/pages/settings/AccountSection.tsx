import { useState } from "react";
import { DELETE_WORD } from "@rig/core";
import { useActions, useAppSelector } from "../../state";
import { SettingRow } from "./parts";

export function AccountSection() {
  const { client, go, toast } = useActions();
  const a = useAppSelector((c) => c.data.account);
  const demo = client.kind === "demo";
  const [leaving, setLeaving] = useState(false);
  const signOut = () => {
    if (leaving) return;
    setLeaving(true);
    client.signOut().then(() => { go("signin"); location.reload(); }, () => {
      setLeaving(false);
      toast("Couldn't sign out just now. Check your internet connection and try again.");
    });
  };

  if (!a) {
    return (
      <SettingRow title="Not signed in" body="Sign in to see this PC from any browser and keep its history if you reinstall.">
        <a className="btn sm" href="#signin">Sign in</a>
      </SettingRow>
    );
  }
  return (
    <>
      <div className="set-row">
        <div className="set-me">
          <span aria-hidden="true">{a.name[0]?.toUpperCase()}</span>
          <div className="set-text"><b>{a.name}</b><p className="muted">{a.email}</p></div>
        </div>
        {!demo && <div className="set-control"><button className="btn sm" type="button" onClick={signOut} disabled={leaving}>{leaving ? "Signing out…" : "Sign out"}</button></div>}
      </div>
      {demo ? (
        <SettingRow title="Delete account" body="This is the demo account, so it can't be deleted. On your own account, this removes it with every PC and its history.">
          <button className="btn sm" type="button" disabled>Delete account</button>
        </SettingRow>
      ) : client.deleteAccount ? <DeleteAccount /> : null}
    </>
  );
}

function DeleteAccount() {
  const { client } = useActions();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pcs = useAppSelector((c) => c.data.pcs.length);
  const ready = typed.trim() === DELETE_WORD && !busy;
  const close = () => { setOpen(false); setTyped(""); setError(null); };

  const run = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      await client.deleteAccount!();
      location.hash = client.kind === "web" ? "signin" : "overview";
      location.reload();
    } catch (e) {
      setError(`Rig couldn't delete the account, so nothing was removed. ${e instanceof Error ? e.message : ""} Check your internet connection and try again.`.replace(/\s+/g, " ").trim());
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <SettingRow title="Delete account" body="Removes the account and everything on it. This can't be undone.">
        <button className="btn sm" type="button" onClick={() => setOpen(true)}>Delete account…</button>
      </SettingRow>
    );
  }
  return (
    <div className="set-danger" role="group" aria-labelledby="delete-h">
      <b id="delete-h">Delete your account?</b>
      <p>This removes, for good:</p>
      <ul>
        <li>Your account: name, email and password or Google sign-in</li>
        <li>{pcs === 1 ? "The PC" : `All ${pcs} PCs`} on it, with their recorded history, settings and change log</li>
        <li>Your chat question count</li>
        <li>Every sign-in, including the Rig app on your PCs</li>
      </ul>
      {client.kind === "desktop" && <p>What this PC keeps on its own disk stays, and Rig keeps working here signed out.</p>}
      <p>Want a copy first? Download my data is under Your data, below.</p>
      <div className="field">
        <label className="label" htmlFor="delete-confirm">Type {DELETE_WORD} to confirm</label>
        <input className="input" id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </div>
      {error && <div className="callout" role="alert">{error}</div>}
      <div className="set-actions">
        <button className="btn sm" type="button" onClick={close} disabled={busy}>Cancel</button>
        <button className="btn sm primary" type="button" onClick={run} disabled={!ready}>{busy ? "Deleting…" : "Delete my account"}</button>
      </div>
    </div>
  );
}
