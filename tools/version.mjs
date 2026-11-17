// One version for the whole product: every package.json, the Tauri config,
// the desktop crate (and its Cargo.lock entry) and the helper.
//   node tools/version.mjs set 0.2.0     writes it everywhere
//   node tools/version.mjs check [v0.2.0] fails if any disagree, or differ from the tag
// --root <dir> runs against another copy of the repo (for the tests).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = at >= 0 ? path.resolve(args.splice(at, 2)[1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Each place a version lives: how to read it and how to write it, as text, so formatting is kept. */
const places = [
  ...["package.json", ...workspacePackages()].map((file) => ({
    file,
    read: (t) => JSON.parse(t).version,
    write: (t, v) => {
      if (JSON.parse(t).version === undefined) throw new Error(`${file} has no "version"`);
      return t.replace(/^( {2}"version":\s*")[^"]*(")/m, `$1${v}$2`);
    },
  })),
  {
    file: "apps/desktop/src-tauri/tauri.conf.json",
    read: (t) => JSON.parse(t).version,
    write: (t, v) => t.replace(/^( {2}"version":\s*")[^"]*(")/m, `$1${v}$2`),
  },
  {
    file: "apps/desktop/src-tauri/Cargo.toml",
    read: (t) => t.match(/^\[package\][^[]*?^version\s*=\s*"([^"]*)"/ms)?.[1],
    write: (t, v) => t.replace(/^(\[package\][^[]*?^version\s*=\s*")[^"]*(")/ms, `$1${v}$2`),
  },
  {
    file: "apps/desktop/src-tauri/Cargo.lock",
    read: (t) => t.match(/^\[\[package\]\]\nname = "rig"\nversion = "([^"]*)"/m)?.[1],
    write: (t, v) => t.replace(/^(\[\[package\]\]\nname = "rig"\nversion = ")[^"]*(")/m, `$1${v}$2`),
  },
  {
    file: "helper/RigHelper/RigHelper.csproj",
    read: (t) => t.match(/<Version>([^<]*)<\/Version>/)?.[1],
    write: (t, v) => t.includes("<Version>")
      ? t.replace(/<Version>[^<]*<\/Version>/, `<Version>${v}</Version>`)
      : t.replace(/^(\s*)(<AssemblyName>)/m, `$1<Version>${v}</Version>\n$1$2`),
  },
];

function workspacePackages() {
  return ["apps", "packages"].flatMap((dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs).sort()
      .map((name) => `${dir}/${name}/package.json`)
      .filter((f) => fs.existsSync(path.join(root, f)));
  });
}

function readAll() {
  return places.map((p) => ({ file: p.file, version: p.read(fs.readFileSync(path.join(root, p.file), "utf8")) ?? null }));
}

function set(v) {
  if (!SEMVER.test(v ?? "")) fail(`Give a version like 0.2.0 or 0.2.0-beta.1, not "${v ?? ""}".`);
  let changed = 0;
  for (const p of places) {
    const abs = path.join(root, p.file);
    const before = fs.readFileSync(abs, "utf8");
    const after = p.write(before, v);
    if (p.read(after) !== v) fail(`Couldn't write the version into ${p.file}.`);
    if (after !== before) { fs.writeFileSync(abs, after); changed++; }
  }
  console.log(changed ? `Rig is now ${v} (${changed} file${changed === 1 ? "" : "s"} changed).` : `Rig is already ${v}.`);
}

function check(tag) {
  const all = readAll();
  const want = tag ? tag.replace(/^refs\/tags\//, "").replace(/^v/, "") : all[0].version;
  const wrong = all.filter((p) => p.version !== want);
  if (wrong.length) {
    const lines = wrong.map((p) => `  ${p.file}: ${p.version ?? "no version"}`).join("\n");
    fail(`${tag ? `Tag ${tag} wants ${want}` : `package.json says ${want}`}, but:\n${lines}\nRun: pnpm version:set ${want}`);
  }
  if (!SEMVER.test(want ?? "")) fail(`"${want}" isn't a version like 0.2.0.`);
  console.log(`Rig ${want}: all ${all.length} files agree${tag ? ` with ${tag}` : ""}.`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [cmd, arg] = args;
if (cmd === "set") set(arg);
else if (cmd === "check") check(arg);
else fail("Usage: node tools/version.mjs set <version> | check [tag]");
