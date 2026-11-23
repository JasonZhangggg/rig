// Rig's setup window (apps/setup) around Tauri's NSIS installer.
//   node tools/setup.mjs stub
//     builds rig-setup.exe and puts it in apps/desktop/src-tauri/setup, where
//     the installer's hooks pick it up as Rig's uninstall window. Run it before
//     `tauri build`.
//   node tools/setup.mjs pack <nsis-installer.exe> <out.exe>
//     writes the setup people download: rig-setup.exe with the installer
//     appended, then {"version","size"} and a trailer (apps/setup/src/payload.rs).
// Windows only, like the installer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauri = path.join(root, "apps/desktop/src-tauri");
const stub = path.join(tauri, "setup/rig-setup.exe");
const MAGIC = Buffer.from("RIGSETUP");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/** Bytes in a file, or in a folder and everything under it. */
function size(p) {
  if (!fs.existsSync(p)) return 0;
  const s = fs.statSync(p);
  return s.isDirectory() ? fs.readdirSync(p).reduce((t, n) => t + size(path.join(p, n)), 0) : s.size;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "stub") {
  const r = spawnSync("cargo", ["build", "--release", "--locked"], { cwd: path.join(root, "apps/setup"), stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.copyFileSync(path.join(root, "apps/setup/target/release/rig-setup.exe"), stub);
  console.log(`Setup window: ${path.relative(root, stub)} (${(size(stub) / 1e6).toFixed(1)} MB)`);
} else if (cmd === "pack") {
  const [installer, out] = rest;
  if (!installer || !out) fail("Usage: node tools/setup.mjs pack <nsis-installer.exe> <out.exe>");
  if (!fs.existsSync(stub)) fail(`No ${path.relative(root, stub)}. Run node tools/setup.mjs stub before tauri build.`);
  const version = JSON.parse(fs.readFileSync(path.join(tauri, "tauri.conf.json"), "utf8")).version;
  // What the installer puts in Rig's folder, for setup's progress bar.
  const installed = size(path.join(tauri, "target/release/rig.exe")) + size(path.join(tauri, "binaries")) + size(path.join(tauri, "pawnio")) + size(stub);
  const meta = Buffer.from(JSON.stringify({ version, size: installed }));
  const body = fs.readFileSync(installer);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([fs.readFileSync(stub), body, meta, u64(body.length), u64(meta.length), MAGIC]));
  console.log(`Rig ${version} setup: ${out} (${(size(out) / 1e6).toFixed(1)} MB, about ${(installed / 1e6).toFixed(0)} MB once installed)`);
} else {
  fail("Usage: node tools/setup.mjs stub | pack <nsis-installer.exe> <out.exe>");
}
