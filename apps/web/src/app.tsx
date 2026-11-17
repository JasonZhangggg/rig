import { createRoot } from "react-dom/client";
import { DemoClient } from "@rig/core/demo";
import { RigApp } from "@rig/ui";
import { CloudClient, paths, type ServerConfig } from "@rig/core";

// /app/?demo runs on two made-up PCs with no account. Otherwise the app
// talks to the Rig server and shows the PCs signed in with this account.
const demo = new URLSearchParams(location.search).has("demo");
const root = createRoot(document.getElementById("root")!);

if (demo) {
  root.render(<RigApp client={new DemoClient()} />);
} else {
  void fetch(`/api${paths.config}`).then((r) => (r.ok ? r.json() as Promise<ServerConfig> : null)).catch(() => null).then((config) => {
    root.render(<RigApp client={new CloudClient({ base: "/api", google: config?.google })} requireAccount />);
  });
}
