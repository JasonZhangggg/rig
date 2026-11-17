import { useState } from "react";
import { exportFileName } from "@rig/core";
import { useApp } from "../../state";
import { SettingRow } from "./parts";

/** Hands the browser a file to save. */
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataSection() {
  const { client, data, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thisPCOnly = client.kind === "desktop" && !data.account;

  const download = async () => {
    setBusy(true); setError(null);
    try {
      const out = await client.exportData!();
      const name = exportFileName();
      saveFile(name, JSON.stringify(out, null, 2));
      toast(`Saved ${name}.`);
    } catch (e) {
      setError(`Rig couldn't put the file together. ${e instanceof Error ? e.message : ""}`.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingRow title="Download my data"
        body={thisPCOnly
          ? "A file with this PC's parts, settings, change log, every temperature reading it has kept, its Windows errors and its recordings."
          : "A file with every PC on your account: parts, settings, change log, temperature history, Windows errors and recordings."}>
        <button className="btn sm" type="button" onClick={download} disabled={busy}>{busy ? "Preparing…" : "Download my data"}</button>
      </SettingRow>
      {error && <div className="callout warn" role="alert">{error}</div>}
    </>
  );
}
