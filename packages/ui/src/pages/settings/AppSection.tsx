import { useCallback, useEffect, useState } from "react";
import type { RecorderStatus } from "@rig/core";
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

export function AppSection() {
  const { host, toast } = useApp();
  const auto = host.autostart!;
  const rec = host.recorder;
  const [on, setOn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    auto.get().then((v) => live && setOn(v)).catch(() => live && setOn(false));
    return () => { live = false; };
  }, [auto]);

  const refresh = useCallback(() => rec?.status().then(setStatus, () => setStatus({ supported: false })), [rec]);
  useEffect(() => { void refresh(); }, [refresh]);

  const flip = async () => {
    if (on == null) return;
    const next = !on;
    setOn(next);
    try { await auto.set(next); } catch (e) {
      setOn(!next);
      toast(`Couldn't change that. ${e instanceof Error ? e.message : ""}`.trim());
    }
  };

  const recording = !!status?.service;
  const flipRecorder = async () => {
    if (!rec || busy) return;
    setBusy(true);
    try {
      await rec.set(!recording);
      toast(recording ? "The background recorder is off, and its log is deleted." : "The background recorder is on.");
    } catch (e) {
      toast(`Couldn't change that. ${e instanceof Error ? e.message : String(e)}`.trim());
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div className="switch-list set-switches">
      <button type="button" className="switch" role="switch" aria-checked={!!on} disabled={on == null} onClick={flip}>
        <span><b>Start Rig with Windows</b><small>Rig opens when you sign in to Windows. Windows asks for permission each time, as it does when you open Rig.</small></span><i />
      </button>
      {rec && status?.supported && (
        <button type="button" className="switch" role="switch" aria-checked={recording} disabled={busy} onClick={flipRecorder}>
          <span>
            <b>Keep a log while Rig is closed</b>
            <small>A small background recorder writes down temperatures, load, crashes, restarts and power loss, so Logs can show what happened even when Rig wasn't open. It stays on this PC and changes nothing. {busy ? "Waiting for Windows…" : recorderLine(status)}</small>
          </span><i />
        </button>
      )}
    </div>
  );
}
