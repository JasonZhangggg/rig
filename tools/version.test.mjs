// tools/version.mjs on a copy of the repo's version files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repo, "tools/version.mjs");
const files = [
  "package.json",
  ...["apps", "packages"].flatMap((d) => fs.readdirSync(path.join(repo, d)).map((n) => `${d}/${n}/package.json`)).filter((f) => fs.existsSync(path.join(repo, f))),
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
  "helper/RigHelper/RigHelper.csproj",
];

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-version-"));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(repo, f), path.join(dir, f));
  }
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [script, "--root", dir, ...args], { encoding: "utf8" });
const snapshot = (dir) => Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));

test("the repo's versions agree", () => {
  execFileSync(process.execPath, [script, "check"], { encoding: "utf8" });
});

test("set writes every file, and setting it back leaves no diff", () => {
  const dir = copy();
  const start = run(dir, "check").status === 0 ? snapshot(dir) : null;
  assert.ok(start, "the copy starts out agreeing");
  const was = JSON.parse(start["package.json"]).version;

  assert.equal(run(dir, "set", "1.2.3-beta.1").status, 0);
  assert.equal(run(dir, "check", "v1.2.3-beta.1").status, 0);
  assert.equal(run(dir, "check", "refs/tags/v1.2.3-beta.1").status, 0);
  const after = snapshot(dir);
  for (const f of files) assert.match(after[f], /1\.2\.3-beta\.1/, f);
  assert.match(after["apps/desktop/src-tauri/Cargo.lock"], /name = "rig"\nversion = "1\.2\.3-beta\.1"/);
  assert.match(after["helper/RigHelper/RigHelper.csproj"], /<Version>1\.2\.3-beta\.1<\/Version>/);

  assert.equal(run(dir, "set", "1.2.3-beta.1").stdout.trim(), "Rig is already 1.2.3-beta.1.");
  assert.equal(run(dir, "set", was).status, 0);
  assert.deepEqual(snapshot(dir), start);
});

test("check fails on a wrong tag or a file that disagrees", () => {
  const dir = copy();
  const wrongTag = run(dir, "check", "v9.9.9");
  assert.equal(wrongTag.status, 1);
  assert.match(wrongTag.stderr, /Tag v9\.9\.9 wants 9\.9\.9/);

  const conf = path.join(dir, "apps/desktop/src-tauri/tauri.conf.json");
  fs.writeFileSync(conf, fs.readFileSync(conf, "utf8").replace(/"version": "[^"]*"/, '"version": "0.0.9"'));
  const off = run(dir, "check");
  assert.equal(off.status, 1);
  assert.match(off.stderr, /tauri\.conf\.json: 0\.0\.9/);
});

test("set refuses something that isn't a version", () => {
  const dir = copy();
  const before = snapshot(dir);
  for (const bad of ["", "v1.2.3", "1.2", "latest"]) assert.equal(run(dir, "set", bad).status, 1, bad);
  assert.deepEqual(snapshot(dir), before);
});
