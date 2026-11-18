import { createRoot } from "react-dom/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CloudClient, LocalClient, MemoryStore, type HelperLink } from "@rig/core";
import { SimulatedLink, fixtures } from "@rig/core/demo";
import { RigApp } from "@rig/ui";
import { inTauri, tauriAutostart, tauriLink, tauriRecorder, tauriStore, tauriToken } from "./tauri";
import { notifyAlerts, notifyRecording } from "./notify";

// The Rig server. An installer build fails without VITE_RIG_API (see vite.config.ts); an empty one counts as missing.
const api = (import.meta.env.VITE_RIG_API as string | undefined) || "http://localhost:8787/api";

async function pickLink(): Promise<HelperLink> {
  if (!inTauri) return new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts);
  try {
    await tauriLink.hello();
    return tauriLink;
  } catch (e) {
    // Only Windows has the helper. On a Mac or Linux dev machine, use a pretend PC.
    if (String(e).includes("unsupported")) return new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts);
    throw e;
  }
}

const root = createRoot(document.getElementById("root")!);
pickLink().then((link) => {
  const cloud = inTauri ? new CloudClient({ base: api, token: tauriToken, openUrl: (u) => void openUrl(u) }) : null;
  // The background recorder only exists with the Windows helper, not with the pretend PC.
  const recorder = inTauri && link === tauriLink ? tauriRecorder : null;
  const client = new LocalClient(link, inTauri ? tauriStore : new MemoryStore(), cloud, inTauri ? { notify: notifyRecording, recorder } : {});
  root.render(<RigApp client={client} host={inTauri ? { autostart: tauriAutostart, server: api, ...(recorder ? { recorder } : {}) } : undefined} />);
  if (inTauri) client.start().then(() => notifyAlerts(client), () => {});
}).catch((e: unknown) => {
  root.render(
    <div className="splash" role="alert">
      <p>Rig couldn't start its helper. {String(e)}</p>
      <p>Restart Rig and choose Yes when Windows asks. If it keeps happening, reinstall Rig.</p>
    </div>,
  );
});
