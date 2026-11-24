// The app shorthand: install, update or uninstall one app with winget, from
// winget's own catalog or the Microsoft Store, never a file or a link. The
// helper runs winget as the person, never with admin rights, and gives it up
// to 30 minutes. Each run stops first when the app isn't as asked (already
// there, not there, or not the version the card names), so its undo puts back
// exactly what was there. An uninstall or an update has nothing that puts
// the person's copy back as it was, so both are tier 3. An update that names
// the version it replaces also tries to install that version again on undo.

import type { Command } from "../change";
import { quote } from "./text";

export type AppSource = "winget" | "msstore";
export interface AppShorthand {
  /** winget's id for the app, like Mozilla.Firefox, or the Microsoft Store's, like 9NBLGGH4NNS1. */
  id: string;
  action: "install" | "upgrade" | "uninstall";
  source: AppSource;
  /** install and upgrade: the version to install. The newest when left out. */
  version?: string;
  /** upgrade only: the version installed now, as read_pc showed it, so undo can install it again. */
  from?: string;
}

const SOURCE_WORDS: Record<AppSource, string> = { winget: "winget's community catalog", msstore: "the Microsoft Store" };
const VERSION = /^[0-9A-Za-z]+([.+_-][0-9A-Za-z]+){0,15}$/;

/** `winget <verb> --exact --source <s> --id <id>`: the form the rules allow, in their order. */
const head = (verb: string, s: AppSource, id: string) => `winget ${verb} --exact --source ${s} --id ${quote(id)}`;
const fails = (what: string) => `if ($LASTEXITCODE -ne 0) { throw ${quote(`winget didn't ${what}. What it printed is above.`)} }`;

/** A command that installs, updates or uninstalls one app with winget. */
export function appCommand(raw: unknown): Command | string {
  const a = (raw ?? {}) as Partial<AppShorthand>;
  if (a.source !== "winget" && a.source !== "msstore") return "source must be winget (winget's community catalog) or msstore (the Microsoft Store)";
  const id = a.id;
  const idOk = typeof id === "string" && (a.source === "winget" ? /^[A-Za-z0-9][A-Za-z0-9+_-]*(\.[A-Za-z0-9+_-]+)+$/.test(id) && id.length <= 128 : /^[A-Za-z0-9]{12,14}$/.test(id));
  if (!idOk) return a.source === "winget" ? "id must be the app's winget id from read_pc, like Mozilla.Firefox, in plain letters and digits" : "id must be the app's Microsoft Store id from read_pc, like 9NBLGGH4NNS1";
  if (a.action !== "install" && a.action !== "upgrade" && a.action !== "uninstall") return "action must be install, upgrade or uninstall";
  for (const k of ["version", "from"] as const) {
    const v = a[k];
    if (v !== undefined && (typeof v !== "string" || v.length > 64 || !VERSION.test(v))) return `${k} must be a version number as winget shows it, like 128.0.3`;
  }
  if (a.version !== undefined && (a.action === "uninstall" || a.source === "msstore")) return a.source === "msstore" ? "the Microsoft Store installs only its newest version, so leave version out" : "version is only for install and upgrade";
  if (a.from !== undefined && (a.action !== "upgrade" || a.source === "msstore")) return a.source === "msstore" ? "the Microsoft Store can't install an older version again, so leave from out" : "from is only for upgrade";
  if (a.from !== undefined && a.from === a.version) return "version and from are the same, so there is nothing to update";

  const s = a.source, name = `${id} from ${SOURCE_WORDS[s]}`;
  const list = `winget list --id ${quote(id!)} --exact --source ${s}`;
  // The run's own look accepts the source's terms like the change after it, so the Store can't stop it with a question.
  const there = `${list} --accept-source-agreements`;
  const version = a.version ? ` --version ${quote(a.version)}` : "";
  const agree = "--silent --accept-source-agreements --accept-package-agreements";
  const uninstall = [`${head("uninstall", s, id!)} --silent --accept-source-agreements`, fails("uninstall it")];
  const licence = "It also accepts the app's licence agreement for you.";

  if (a.action === "install") {
    return {
      does: `Installs ${name}${a.version ? `, version ${a.version}` : ""}, with winget. ${licence} Undo uninstalls it.`,
      read: list,
      run: [there, `if ($LASTEXITCODE -eq 0) { throw ${quote(`${id} is already installed, so there is nothing to install.`)} }`, `${head("install", s, id!)}${version} ${agree}`, fails("install it")].join("\n"),
      undo: uninstall.join("\n"),
      touches: [{ kind: "other", name: `The app ${id}` }],
    };
  }
  const installed = [there, `if ($LASTEXITCODE -ne 0) { throw ${quote(`${id} isn't installed from ${SOURCE_WORDS[s]}, so there is nothing to ${a.action === "upgrade" ? "update" : "uninstall"}.`)} }`];
  if (a.action === "uninstall") {
    return {
      does: `Uninstalls ${name} with winget. Rig can't put it back as it was, so this always gets Rig's strongest check.`,
      read: list,
      run: [...installed, ...uninstall].join("\n"),
      touches: [{ kind: "other", name: `The app ${id}` }],
    };
  }
  const to = a.version ? `version ${a.version}` : "its newest version";
  const run = [...installed];
  if (a.from) {
    const escape = (text: string) => text.replace(/[.+]/g, "\\$&");
    const pattern = `(^|\\s)${escape(id!)}\\s+${escape(a.from)}(\\s|$)`;
    run.push(
      `$now = ${there} | Out-String`,
      `if ($now -notmatch ${quote(pattern)}) { throw ${quote(`${id} isn't at version ${a.from} now, so Rig won't update it from there.`)} }`,
      `winget show --id ${quote(id!)} --exact --source ${s} --version ${quote(a.from)}`,
      `if ($LASTEXITCODE -ne 0) { throw ${quote(`winget can't install version ${a.from} again, so Rig couldn't undo this. Ask for the update without keeping the old version.`)} }`,
    );
  }
  run.push(`${head("upgrade", s, id!)}${version} ${agree}`, fails("update it"));
  return {
    does: a.from
      ? `Updates ${name} from version ${a.from} to ${to}, with winget. ${licence} Rig can't promise to put the old version back as it was, so this always gets Rig's strongest check. Undo tries: it uninstalls the app and installs version ${a.from} again.`
      : `Updates ${name} to ${to}, with winget. ${licence} Rig can't put the old version back, so this always gets Rig's strongest check.`,
    read: list,
    run: run.join("\n"),
    ...(a.from ? { undo: [...uninstall, `${head("install", s, id!)} --version ${quote(a.from)} ${agree}`, fails("install the old version again")].join("\n") } : {}),
    touches: [{ kind: "other", name: `The app ${id}` }],
  };
}
