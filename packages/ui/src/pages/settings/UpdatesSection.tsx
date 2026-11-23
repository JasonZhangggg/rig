import { useApp, useUpdates, type UpdateState } from "../../state";
import { rigVersion } from "../../version";
import { SettingRow } from "./parts";

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** What closes and what Windows asks, said wherever Update can be pressed. */
export const updateWhat = "Rig closes while it installs, and Windows asks once for permission so the background recorder updates too.";

function line(s: UpdateState): string {
  switch (s.kind) {
    case "idle": case "checking": return "Checking for a newer version…";
    case "current": return `This is the newest version. Checked ${ago(s.checkedAt)}.`;
    case "ready": return `Rig ${s.version} is ready to install. ${updateWhat}`;
    case "installing": return `Downloading and installing Rig ${s.version}. Rig closes and opens again on its own when it's done.`;
    case "failed": return s.step === "check"
      ? "Rig couldn't check for updates just now. Check your internet connection and try again."
      : `Rig ${s.version ?? "the update"} didn't install, so Rig stays on this version for now. Try again in a moment.`;
  }
}

/** The version this is, whether a newer one is ready, and the buttons to check and update. Only the desktop app has this. */
export function UpdatesSection() {
  const { host } = useApp();
  const s = useUpdates(host);
  const u = host.updates!;
  const button = s.kind === "ready" || (s.kind === "failed" && s.step === "install")
    ? <button className="btn primary" type="button" onClick={() => void u.install()}>{s.kind === "ready" ? `Update to ${s.version}` : "Try again"}</button>
    : <button className="btn" type="button" disabled={s.kind === "idle" || s.kind === "checking" || s.kind === "installing"} onClick={() => void u.check()}>
        {s.kind === "checking" ? "Checking…" : s.kind === "installing" ? "Updating…" : "Check for updates"}
      </button>;
  return (
    <>
      <SettingRow title={`Rig ${rigVersion}`} body={<span role="status">{line(s)}</span>}>{button}</SettingRow>
      <SettingRow title="Checking on its own" body="Rig looks for a new version when it opens and every few hours. When one is ready, a small notice shows in the corner, and nothing installs until you choose Update." />
    </>
  );
}
