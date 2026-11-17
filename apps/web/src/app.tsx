import { createRoot } from "react-dom/client";
import { DemoClient } from "@rig/core/demo";
import { RigApp } from "@rig/ui";
import { CloudClient } from "@rig/core";

// /app/?demo runs on two made-up PCs with no account. Otherwise the app
// talks to the Rig server and shows the PCs signed in with this account.
const demo = new URLSearchParams(location.search).has("demo");
const client = demo ? new DemoClient() : new CloudClient({ base: "/api" });

createRoot(document.getElementById("root")!).render(<RigApp client={client} requireAccount={!demo} />);
