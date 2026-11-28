import { createRoot } from "react-dom/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CloudClient, LocalClient, MemoryStore, type HelperLink } from "@rig/core";
import { SimulatedLink, fixtures } from "@rig/core/demo";
import { RigApp, Splash } from "@rig/ui";
import { approveStep, inTauri, openLogs, tauriAutostart, tauriLink, tauriRecorder, tauriStore, tauriToken } from "./tauri";
import { notifyAlerts, notifyRecording } from "./notify";
import { quietWhenHidden } from "./quiet";
import { tauriUpdates, watchForUpdates } from "./update";
import { log, logUncaught } from "./log";
import { installContextMenu } from "./contextmenu";

// The Rig server. An installer build fails without VITE_RIG_API (see vite.config.ts); an empty one counts as missing.
const api = (import.meta.env.VITE_RIG_API as string | undefined) || "http://localhost:8787/api";

async function pickLink(): Promise<HelperLink> {
  if (!inTauri) return new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts);
  const t = performance.now();
  try {
    const hello = await tauriLink.hello();
    log("info", `helper: hello in ${Math.round(performance.now() - t)} ms, version ${hello.version}, admin ${hello.elevated ? "yes" : "no"}`);
    return tauriLink;
  } catch (e) {
    log("error", `helper: hello failed after ${Math.round(performance.now() - t)} ms: ${String(e)}`);
    // Only Windows has the helper. On a Mac or Linux dev machine, use a pretend PC.
    if (String(e).includes("unsupported")) return new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts);
    throw e;
  }
}

if (inTauri) { logUncaught(); watchForUpdates(); installContextMenu(); }

const root = createRoot(document.getElementById("root")!);

/** What went wrong starting the helper, without repeating the headline above it. */
const helperProblem = (e: unknown) => String(e).replace(/^Error:\s*/, "").replace(/^Rig couldn't start its helper\.\s*/, "");

function start() {
  // The helper starts behind the Windows admin prompt, so the window says what's coming instead of staying blank.
  root.render(<Splash text="Starting Rig…" detail={inTauri ? "If Windows asks whether Rig can make changes, choose Yes so it can read every sensor." : undefined} />);
  pickLink().then((link) => {
    const cloud = inTauri ? new CloudClient({ base: api, token: tauriToken, openUrl: (u) => void openUrl(u), log }) : null;
    // The background recorder only exists with the Windows helper, not with the pretend PC.
    const recorder = inTauri && link === tauriLink ? tauriRecorder : null;
    const client = new LocalClient(link, inTauri ? tauriStore : new MemoryStore(), cloud, inTauri ? { notify: notifyRecording, recorder, log, ...(link === tauriLink ? { approveStep } : {}) } : { log });
    root.render(<RigApp client={client} host={inTauri ? { autostart: tauriAutostart, server: api, openLogs, updates: tauriUpdates, ...(recorder ? { recorder } : {}) } : undefined} />);
    if (inTauri) { quietWhenHidden(client); client.start().then(() => notifyAlerts(client), () => {}); }
  }).catch((e: unknown) => {
    // Trying again starts the helper afresh, with the Windows prompt again, so there's no need to quit Rig first.
    root.render(
      <Splash
        text="Rig couldn't start its helper, which reads your PC's sensors."
        detail={`${helperProblem(e)} Try again, and if it keeps happening, reinstall Rig.`.trim()}
        retry={start}
        logs={inTauri ? openLogs : undefined}
      />,
    );
  });
}

start();
