import { useCallback, useEffect, useState } from "react";
import { probeWhen, type ProbeStatus, type RecorderStatus } from "@rig/core";
import { useApp } from "../../state";

const mb = (bytes: number) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`);
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** One line on what the background recorder is doing. */
function recorderLine(s: RecorderStatus | null): string {
  if (!s) return "Checking…";
  if (!s.service) return "Off. Rig records only while its window is open. Turning this on asks Windows for permission.";
  if (s.service !== "running") return "Installed but not running. Turn it off and on again to restart it.";
  const size = s.bytes ? ` Its log takes ${mb(s.bytes)}${s.days ? ` for ${s.days} day${s.days === 1 ? "" : "s"}` : ""}, and days past 30 are deleted.` : "";
  return `On${s.lastT ? `, last wrote ${ago(s.lastT)}` : ""}.${size}`;
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** What a custom log is, who asked for it and how it's doing, in one line. */
function probeLine(p: ProbeStatus): string {
  const who = `${p.by === "chat" ? "Asked for by Rig's chat" : "Set up by you"} on ${when(p.createdAt)}.`;
  const script = p.kind === "script" ? ` A ${p.shell === "cmd" ? "cmd" : "PowerShell"} script run ${p.admin ? "as admin" : "as you"}, approved${p.approvedAt ? ` ${when(p.approvedAt)}` : ""}${p.hash ? ` (fingerprint ${p.hash.slice(0, 8)})` : ""}.` : "";
  const state = p.state === "paused" ? " Paused." : p.state === "error" ? ` Not working: ${p.error ?? "it couldn't read"}.` : p.state === "waiting" ? " Waiting for its condition." : "";
  return `${who}${script} Reads ${probeWhen(p)} until ${when(p.expiresAt)}.${state}`;
}

/** The custom logs the recorder keeps for this account, each with a switch, and a way to turn one off for good. */
function CustomLogs({ status, refresh }: { status: RecorderStatus; refresh: () => void }) {
  const { host, client, toast } = useApp();
  const rec = host.recorder;
  const [busy, setBusy] = useState<string | null>(null);
  const list = status.probes?.list ?? [];
  if (!rec?.probes || !status.service || (!list.length && !status.probes?.problems?.length)) return null;
  const edit = async (id: string, op: "pause" | "resume" | "remove") => {
    if (busy) return;
    setBusy(id);
    try {
      await rec.probes!({ op, id });
      toast(op === "remove" ? "Turned off. What it wrote stays in Logs until the log's usual clean-up." : op === "pause" ? "Paused." : "Back on.");
      void client.refreshBackground?.();
    } catch (e) {
      toast(`Couldn't change that. ${e instanceof Error ? e.message : String(e)} Try again, and choose Yes if Windows asks for permission.`.replace(/\s+/g, " ").trim());
    } finally {
      setBusy(null);
      refresh();
    }
  };
  return (
    <div className="custom-logs">
      <h4>Custom logs</h4>
      {list.map((p) => (
        <div key={p.id} className="custom-log-row">
          <button type="button" className="switch" role="switch" aria-checked={p.state !== "paused"} disabled={busy === p.id} onClick={() => void edit(p.id, p.state === "paused" ? "resume" : "pause")}>
            <span><b>{p.label}</b><small>{probeLine(p)}</small></span><i />
          </button>
          <button type="button" className="btn sm" disabled={busy === p.id} onClick={() => void edit(p.id, "remove")}>Remove</button>
        </div>
      ))}
      {status.probes?.problems?.map((x) => <p key={x} className="faint">{x}</p>)}
    </div>
  );
}

export function AppSection() {
  const { host, toast } = useApp();
  const auto = host.autostart!;
  const rec = host.recorder;
  const [on, setOn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    let live = true;
    auto.get().then((v) => live && setOn(v)).catch(() => live && setOn(false));
    return () => { live = false; };
  }, [auto]);

  const refresh = useCallback(() => rec?.status().then(setStatus, () => setStatus({ supported: false })), [rec]);
  useEffect(() => { void refresh(); }, [refresh]);

  const [starting, setStarting] = useState(false);
  const flip = async () => {
    if (on == null || starting) return;
    const next = !on;
    setOn(next);
    setStarting(true);
    try { await auto.set(next); } catch (e) {
      setOn(!next);
      toast(`Couldn't change that. ${e instanceof Error ? e.message : ""} Try again, and choose Yes if Windows asks for permission.`.replace(/\s+/g, " ").trim());
    } finally {
      setStarting(false);
    }
  };

  const recording = !!status?.service;
  const flipRecorder = async () => {
    if (!rec || busy) return;
    setAsking(false);
    setBusy(true);
    try {
      await rec.set(!recording);
      toast(recording ? "The background recorder is off, and its log is deleted." : "The background recorder is on.");
    } catch (e) {
      toast(`Couldn't change that. ${e instanceof Error ? e.message : String(e)} Try again, and choose Yes if Windows asks for permission.`.replace(/\s+/g, " ").trim());
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div className="switch-list set-switches">
      <button type="button" className="switch" role="switch" aria-checked={!!on} disabled={on == null || starting} onClick={flip}>
        <span><b>Start Rig with Windows</b><small>Rig opens when you sign in to Windows. Windows asks for permission each time, as it does when you open Rig.{starting ? " Waiting for Windows…" : ""}</small></span><i />
      </button>
      {rec && status?.supported && (
        <button type="button" className="switch" role="switch" aria-checked={recording} disabled={busy} onClick={() => (recording ? setAsking(true) : void flipRecorder())}>
          <span>
            <b>Keep a log while Rig is closed</b>
            <small>A small background recorder writes down temperatures, usage, crashes, restarts and power loss, so Logs can show what happened even when Rig wasn't open. It stays on this PC and changes nothing on it.{recording ? " Turning it off deletes what it wrote." : ""} {busy ? "Waiting for Windows…" : recorderLine(status)}</small>
          </span><i />
        </button>
      )}
      {asking && (
        <div className="set-danger" role="group" aria-labelledby="rec-off-h">
          <b id="rec-off-h">Turn off the background log?</b>
          <p>This deletes everything it wrote on this PC while Rig was closed. You can't undo this.</p>
          <div className="set-actions">
            <button type="button" className="btn sm" onClick={() => setAsking(false)} autoFocus>Keep it on</button>
            <button type="button" className="btn sm primary" onClick={() => void flipRecorder()}>Turn off and delete</button>
          </div>
        </div>
      )}
      {rec && status?.supported && <CustomLogs status={status} refresh={() => void refresh()} />}
    </div>
  );
}
