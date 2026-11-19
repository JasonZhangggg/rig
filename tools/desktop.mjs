// Runs the desktop app from this copy of the code: `pnpm desktop`.
// On Windows it first builds RigHelper (only when its code changed since the
// last build) and fetches PawnIO's setup, which the Tauri build needs next to
// the app. It signs in to the live Rig server unless VITE_RIG_API says otherwise.
// On a Mac or Linux the app runs on a simulated PC, so it goes straight to Tauri.
// --prepare stops before starting the app (used to check the Windows steps).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_API = "https://rig.jasonxyz.workers.dev/api";

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** True when cmd runs from this shell. */
function has(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return !r.error && r.status === 0;
}

const prepareOnly = process.argv.includes("--prepare");
const win = process.platform === "win32";
const wsl = !win && (!!process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release()));

/** Stops with everything that's missing at once, before anything is built or downloaded. */
function preflight(needDotnet) {
  if (wsl) {
    console.error(
      "Rig reads this PC's sensors through Windows, and this terminal is Linux inside WSL.\n" +
        "Open Windows PowerShell, clone the repo to a Windows folder (like C:\\code\\rig) and run pnpm install, then pnpm desktop there.",
    );
    process.exit(1);
  }
  const missing = [];
  if (!prepareOnly && !has("cargo"))
    missing.push(win ? "Rust: install it from https://rustup.rs and choose the Visual Studio C++ build tools when it asks." : "Rust: install it from https://rustup.rs.");
  if (needDotnet && !has("dotnet")) missing.push(".NET 8 SDK: install it from https://dotnet.microsoft.com/download/dotnet/8.0.");
  if (missing.length) {
    console.error(`pnpm desktop needs:\n${missing.map((m) => `  - ${m}`).join("\n")}\nOpen a new terminal after installing, so it finds them.`);
    process.exit(1);
  }
  if (!win) console.log("Not on Windows, so Rig runs on a simulated PC.");
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

const src = path.join(root, "helper/RigHelper");
const out = path.join(root, "apps/desktop/src-tauri/binaries/RigHelper-x86_64-pc-windows-msvc.exe");
const helperStale = win && (!fs.existsSync(out) || fs.statSync(out).mtimeMs < newest(src));
preflight(helperStale);

if (win) {
  if (helperStale) {
    console.log("Building Rig's helper...");
    run("dotnet", ["publish", "helper/RigHelper", "-c", "Release", "-o", "helper-out"]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(root, "helper-out/RigHelper.exe"), out);
  } else {
    console.log("Rig's helper is up to date.");
  }
  run("node", ["tools/pawnio.mjs"]);
}

if (prepareOnly) process.exit(0);
const api = process.env.VITE_RIG_API || LIVE_API;
console.log(`Starting Rig, signed in to ${api}`);
run("pnpm", ["--filter", "@rig/desktop", "tauri", "dev"], { ...process.env, VITE_RIG_API: api });
