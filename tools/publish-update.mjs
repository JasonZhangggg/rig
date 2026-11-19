// Puts a release where installed copies of Rig update from: the rig-updates R2
// bucket that the server's /api/updates routes read (apps/server/src/routes-updates.ts).
//   node tools/publish-update.mjs <version> <installer.exe> <installer.exe.sig>
// It uploads the installer, puts it first in releases.json, and deletes the
// installers of all but the latest three releases. Running it again for the
// same version replaces that release. Needs CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID, like the Deploy workflow. RIG_R2_LOCAL=<dir> uses
// wrangler's local storage in that folder instead (for trying it out).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "rig-updates";
const KEEP = 3;
const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/server");
const where = process.env.RIG_R2_LOCAL ? ["--local", "--persist-to", path.resolve(process.env.RIG_R2_LOCAL)] : ["--remote"];

function wrangler(...args) {
  const r = spawnSync("npx", ["wrangler", "r2", "object", ...args, ...where], { cwd: server, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` };
}

function must(...args) {
  const r = wrangler(...args);
  if (!r.ok) { console.error(r.out); throw new Error(`wrangler r2 object ${args[0]} ${args[1]} failed`); }
}

/** The releases already published, newest first. Empty when nothing has been published yet. */
function current() {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rig-")), "releases.json");
  const r = wrangler("get", `${BUCKET}/releases.json`, "--file", tmp);
  if (!r.ok) {
    if (/not found|does not exist|NoSuchKey|10007/i.test(r.out)) return [];
    console.error(r.out);
    throw new Error("Couldn't read releases.json from the rig-updates bucket. Has the Deploy workflow run since updates were added?");
  }
  return JSON.parse(fs.readFileSync(tmp, "utf8"));
}

// wrangler runs from apps/server, so paths given relative to here are made absolute first.
const [version, installer, sigFile] = process.argv.slice(2).map((a, i) => (i > 0 ? path.resolve(a) : a));
if (!sigFile || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node tools/publish-update.mjs <version like 1.2.3> <installer.exe> <installer.exe.sig>");
  process.exit(2);
}
const file = `Rig-Setup-${version}-x64.exe`;
const release = { version, file, signature: fs.readFileSync(sigFile, "utf8").trim(), pub_date: new Date().toISOString() };

const before = current();
const after = [release, ...before.filter((r) => r.version !== version)].slice(0, KEEP);
const kept = new Set(after.map((r) => r.file));
const dropped = before.filter((r) => !kept.has(r.file));

// The installer goes up before the list points at it, and old installers go only after the list stops pointing at them.
must("put", `${BUCKET}/${file}`, "--file", installer, "--content-type", "application/octet-stream");
const list = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rig-")), "releases.json");
fs.writeFileSync(list, JSON.stringify(after, null, 2));
must("put", `${BUCKET}/releases.json`, "--file", list, "--content-type", "application/json", "--cache-control", "no-store");
for (const r of dropped) must("delete", `${BUCKET}/${r.file}`);

console.log(`Installed copies now update to ${version}. Kept: ${after.map((r) => r.version).join(", ")}.${dropped.length ? ` Deleted: ${dropped.map((r) => r.version).join(", ")}.` : ""}`);
