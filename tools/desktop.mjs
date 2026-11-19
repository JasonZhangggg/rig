// Runs the desktop app from this copy of the code: `pnpm desktop`.
// On Windows it first builds RigHelper (only when its code changed since the
// last build) and fetches PawnIO's setup, which the Tauri build needs next to
// the app. It signs in to the live Rig server unless VITE_RIG_API says otherwise.
// On a Mac or Linux the app runs on a simulated PC, so it goes straight to Tauri.
// --prepare stops before starting the app (used to check the Windows steps).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_API = "https://rig.jasonxyz.workers.dev/api";

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Newest change time of any file under dir, skipping build output. */
function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "bin" || e.name === "obj") continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

if (process.platform === "win32") {
  const src = path.join(root, "helper/RigHelper");
  const out = path.join(root, "apps/desktop/src-tauri/binaries/RigHelper-x86_64-pc-windows-msvc.exe");
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < newest(src)) {
    console.log("Building Rig's helper...");
    run("dotnet", ["publish", "helper/RigHelper", "-c", "Release", "-o", "helper-out"]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(root, "helper-out/RigHelper.exe"), out);
  } else {
    console.log("Rig's helper is up to date.");
  }
  run("node", ["tools/pawnio.mjs"]);
}

if (process.argv.includes("--prepare")) process.exit(0);
const api = process.env.VITE_RIG_API || LIVE_API;
console.log(`Starting Rig, signed in to ${api}`);
run("pnpm", ["--filter", "@rig/desktop", "tauri", "dev"], { ...process.env, VITE_RIG_API: api });
