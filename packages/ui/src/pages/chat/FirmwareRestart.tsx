import { useEffect, useState } from "react";
import { RESTART_WORDS, type ChatMessage } from "@rig/core";
import { ChangeList, nativeParts } from "../../components/change";
import { useActions, useStillPC } from "../../state";

const part = nativeParts.restartToFirmware;
const op = { name: "restartToFirmware" } as const;
const SECONDS = 60;

function useSecondsLeft(at: string | undefined, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on, at]);
  return at ? Math.min(SECONDS, Math.max(0, SECONDS - Math.floor((now - Date.parse(at)) / 1000))) : SECONDS;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The app's own button under firmware setup steps. It takes nothing from the chat: Rig reads first, Windows asks, and the restart waits a minute with Cancel. */
export function FirmwareRestart({ m }: { m: ChatMessage }) {
  const { client, firmwareRestart } = useActions();
  const pc = useStillPC();
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState(false);
  const r = m.restart ?? {};
  const a = r.outcome?.apply;
  const counting = a?.outcome === "applied" && r.outcome?.undo?.outcome !== "undone";
  const left = useSecondsLeft(r.at, counting);
  if (!client.caps.applyChanges) return null;
  const act = (what: Parameters<typeof firmwareRestart>[1]) => { setBusy(true); void firmwareRestart(m.id, what).finally(() => setBusy(false)); };

  if (!r.preview) {
    return (
      <div className="proposal-foot restart-offer">
        <span className="faint">Rig can restart {pc.name} into firmware setup for you.</span>
        <button className="btn sm" type="button" disabled={busy} onClick={() => act("read")}>{busy ? "Checking…" : "Restart into firmware setup"}</button>
      </div>
    );
  }
  if (r.preview.outcome === "refused") {
    return (
      <div className="proposal restart-card">
        <div className="proposal-head"><h3>{part.title(op)}</h3><span className="chip">Nothing changed</span></div>
        <div className="cc-facts"><p className="cc-refused">{r.preview.verdict.refused}</p></div>
      </div>
    );
  }
  const ready = r.preview;
  const red = part.red!(op);
  const tick = part.confirm!(op, ready.read);

  if (a?.outcome === "applied") {
    const undo = r.outcome?.undo;
    return (
      <div className="proposal restart-card">
        <div className="proposal-head"><h3>{part.title(op)}</h3>{undo?.outcome === "undone" ? <span className="chip">Cancelled</span> : <span className="chip tier-red">Restarting</span>}</div>
        <div className="cc-facts">
          {undo?.outcome === "undone" ? (
            <p className="cc-note" role="status">Restart cancelled. Windows may still open firmware setup the next time {pc.name} restarts.</p>
          ) : (
            <p className="cc-refused" role="timer" aria-live="off">{left > 0 ? `Restarting in ${clock(left)}. Save your work now.` : "Restarting now."} Firmware setup opens next.</p>
          )}
          {undo && undo.outcome !== "undone" && <p className="cc-note cc-no" role="alert">Windows didn't stop the restart{undo.outcome === "failed" ? `: ${undo.error}` : "."}</p>}
        </div>
        {undo?.outcome !== "undone" && left > 0 && (
          <div className="proposal-foot">
            <span className="faint">{red.undo}</span>
            <button className="btn primary sm" type="button" disabled={busy} onClick={() => act("cancel")}>{busy ? "Cancelling…" : "Cancel restart"}</button>
          </div>
        )}
      </div>
    );
  }

  const note = !a ? null
    : a.outcome === "declined" ? "Windows' permission prompt was closed, so nothing was set."
    : a.outcome === "refused" ? `Nothing was set. ${a.verdict.refused}`
    : a.outcome === "limit" ? `Nothing was set. Rig makes only a few bigger changes a day on ${pc.name}, and it has had today's.`
    : a.outcome === "rolledBack" ? `Nothing was set.${a.error ? ` ${a.error}` : ""}`
    : "Nothing was set. Check again.";
  return (
    <div className="proposal restart-card">
      <div className="proposal-head"><h3>{part.title(op)}</h3><span className="chip tier-red">{red.chip}</span></div>
      <div className="cc-first" role="note"><b>{red.head}</b></div>
      <ChangeList changes={part.changes(op, ready.read)} />
      <div className="cc-facts">
        <p className="cc-note">{RESTART_WORDS.tier} Windows asks for permission first.</p>
        {part.more?.(op, ready.read, pc.name)}
        {note && <p className="cc-note" role="status">{note}</p>}
      </div>
      {tick && <label className="cc-confirm"><input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} disabled={busy} /> {tick}</label>}
      <div className="proposal-foot">
        <span className="faint">Nothing happens until you press Restart.</span>
        <button className="btn ghost sm" type="button" disabled={busy} onClick={() => act("reset")}>Not now</button>
        {a && a.outcome !== "declined"
          ? <button className="btn sm" type="button" disabled={busy} onClick={() => act("read")}>Check again</button>
          : <button className="btn danger sm" type="button" disabled={busy || (!!tick && !ticked)} onClick={() => act("apply")}>{busy ? "Waiting for Windows…" : "Restart in 1 minute"}</button>}
      </div>
    </div>
  );
}
