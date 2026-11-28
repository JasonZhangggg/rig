// "Safe and up to date": Windows updates, virus protection, the firewall and
// backup, as the helper read them (helper/RigHelper/Security.cs). Only reads.
// Rows for the screen and findings for the health score come from the same
// checks here, so the two always agree. What wasn't read stays unknown: a row
// never says something is fine that Rig didn't see.

import type { Finding } from "./diagnose";
import type { PC } from "./model";
import { machineWord } from "./machineWord";

/** One antivirus Windows Security Center knows about. `upToDate` is missing when Security Center didn't say. */
export interface AntivirusProduct { name: string; enabled: boolean; upToDate?: boolean }

/** Microsoft Defender's own status. Each field is missing when Defender didn't report it. */
export interface DefenderStatus {
  realTime?: boolean;
  /** Days since its virus definitions were updated. */
  signatureAgeDays?: number;
  /** Days since its last quick scan. */
  quickScanAgeDays?: number;
  /** "Normal" when it's the antivirus in charge; "Passive Mode" and the like when another one is. */
  mode?: string;
}

/** Windows Firewall per network profile, and any other firewall Security Center knows about. A profile it couldn't read is missing. */
export interface FirewallStatus {
  domain?: boolean;
  private?: boolean;
  public?: boolean;
  products?: { name: string; enabled: boolean }[];
}

export interface UpdateStatus {
  /** When Windows last installed an update, in milliseconds. */
  lastInstalledAt?: number;
  /** An installed update waits for a restart. */
  restartPending?: boolean;
  /** About when the restart started waiting, in milliseconds. */
  restartSince?: number;
}

export interface BackupStatus {
  /** When File History last copied files, in milliseconds. Missing when it isn't set up or couldn't be read. */
  fileHistoryAt?: number;
  /** The folders OneDrive keeps a copy of ("Desktop", "Documents", "Pictures"). Empty: none. Missing: couldn't be read. */
  oneDrive?: string[];
}

/**
 * What the helper read about keeping the PC safe, at the same pace as the other settings. Every part is optional: an older
 * helper sends none of it, and a part Windows didn't answer for is left out (Windows Server has no Security Center).
 */
export interface SecurityFacts {
  /** When it was read, in milliseconds. */
  readAt: number;
  /** Missing: Security Center couldn't be read. Empty: it answered and knows no antivirus. */
  antivirus?: AntivirusProduct[];
  defender?: DefenderStatus;
  firewall?: FirewallStatus;
  updates?: UpdateStatus;
  backup?: BackupStatus;
}

export type SafetyId = "updates" | "antivirus" | "firewall" | "backup";
/** ok: read and fine. look: something needs a look. none: read, and there's nothing set up. unknown: not read. */
export type SafetyState = "ok" | "look" | "none" | "unknown";

export interface SafetyRow {
  id: SafetyId;
  title: string;
  state: SafetyState;
  /** The grey line: what Rig read, in a few words. */
  line: string;
  /** A short chip, only when something needs a look. */
  chip?: string;
  /** What Details says: why it matters, and what Rig read. */
  why: string;
  /** What to do in Windows, when there's something to do. */
  steps?: string;
  /** The row's one action and the question it starts the chat with. */
  action: string;
  ask: string;
}

const DAY = 864e5;
/** A restart that has waited this long needs a look. */
export const RESTART_LOOK_DAYS = 2;
/** No update installed for this long needs a look. Windows installs one at least every month. */
export const UPDATE_LOOK_DAYS = 45;
/** Defender's virus definitions this old need a look. It updates them every day. */
export const SIGNATURES_LOOK_DAYS = 7;

const daysSince = (t: number, now: number) => Math.max(0, Math.floor((now - t) / DAY));
const agoWords = (days: number) => (days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const isDefender = (name: string) => /defender/i.test(name);

// ----- The four checks -----

type Check = Omit<SafetyRow, "id" | "title"> & { finding?: Omit<Finding, "category" | "id"> & { id: string } };

function updates(u: UpdateStatus | undefined, now: number, w: string): Check {
  const action = "Ask about updates";
  if (!u || (u.lastInstalledAt == null && u.restartPending == null)) {
    return { state: "unknown", line: "Rig couldn't read Windows Update", why: "Windows didn't say when it last installed an update.", action, ask: `How do I check that Windows Update is working on my ${w}?` };
  }
  const last = u.lastInstalledAt != null ? daysSince(u.lastInstalledAt, now) : null;
  const lastLine = last != null ? `Last update ${agoWords(last)}` : "Rig couldn't tell when the last update was";
  const waited = u.restartPending && u.restartSince != null ? daysSince(u.restartSince, now) : null;
  if (u.restartPending && waited != null && waited >= RESTART_LOOK_DAYS) {
    const since = `${waited} days`;
    return {
      state: "look", chip: "Restart waiting", line: `${lastLine} · waiting ${since}`,
      why: `An update installed ${since} ago and waits for a restart to finish. Until then it isn't protecting this ${w}.`,
      steps: "Save your work, then open Start, Power and choose Update and restart.",
      action: "Ask about it", ask: `A Windows update has waited ${since} for a restart. Is it safe to restart now, and what does it fix?`,
      finding: {
        id: "update-restart", weight: 10, severity: "warn", part: "windows", confidence: "sure", evidence: [`Restart waiting for about ${since}`],
        title: "Restart to finish a Windows update", body: `An update has waited ${since} for a restart. Save your work, then open Start, Power and choose Update and restart.`,
        action: "Ask about it", go: "chat", ask: `A Windows update has waited ${since} for a restart. Is it safe to restart now, and what does it fix?`,
      },
    };
  }
  if (last != null && last >= UPDATE_LOOK_DAYS) {
    return {
      state: "look", chip: `${last} days`, line: lastLine,
      why: `Windows usually installs an update at least once a month. The last one here was ${last} days ago, so updates may be paused or failing.`,
      steps: "Open Settings, Windows Update, and choose Check for updates. If updates are paused, choose Resume updates.",
      action: "Ask what to do", ask: `Windows hasn't installed an update on my ${w} in ${last} days. How do I get it updating again?`,
      finding: {
        id: "update-old", weight: 15, severity: "warn", part: "windows", confidence: "sure", evidence: [`Last update installed ${last} days ago`],
        title: `No Windows update in ${last} days`, body: "Windows usually installs one every month. Open Settings, Windows Update, and choose Check for updates.",
        action: "Ask what to do", go: "chat", ask: `Windows hasn't installed an update on my ${w} in ${last} days. How do I get it updating again?`,
      },
    };
  }
  const pending = u.restartPending ? " · restart waiting" : "";
  return {
    state: last != null ? "ok" : "unknown", line: `${lastLine}${pending}`,
    why: u.restartPending ? "Windows is up to date apart from one restart to finish an update. Restart when it suits you." : "Windows installs updates by itself. Rig checks that they keep coming.",
    action, ask: `Is my ${w} up to date with Windows updates?`,
  };
}

function antivirus(products: AntivirusProduct[] | undefined, d: DefenderStatus | undefined, w: string): Check {
  const action = "Ask about it";
  if (!products && !d) {
    return { state: "unknown", line: "Rig couldn't read virus protection", why: "Windows Security didn't answer, so Rig can't say which antivirus is on.", action, ask: "How do I check that virus protection is on in Windows?" };
  }
  const on = (products ?? []).filter((p) => p.enabled);
  // Defender in charge: Security Center says so, or with no Security Center (Windows Server) Defender itself says it's on.
  const defenderMode = d?.mode == null || /normal/i.test(d.mode);
  const defenderOn = on.some((p) => isDefender(p.name)) || (defenderMode && d?.realTime === true && !on.some((p) => !isDefender(p.name)));
  if (!on.length && !defenderOn) {
    // Security Center answered with nothing on, or Defender alone answered and said real-time protection is off.
    if (products || d?.realTime === false) {
      const named = products?.[0]?.name ?? "Microsoft Defender";
      return {
        state: "look", chip: "Off", line: products?.length ? `${named} is off` : products ? "No antivirus found" : "Microsoft Defender is off",
        why: "Nothing is checking the files you open, download or install for viruses.",
        steps: "Open Windows Security, Virus & threat protection, and turn on Real-time protection.",
        action: "Ask what to do", ask: "Windows says no virus protection is on. How do I turn it back on?",
        finding: {
          id: "antivirus-off", weight: 30, severity: "bad", part: "windows", confidence: "sure", evidence: [products?.length ? `${named} reports it is off` : products ? "Windows Security knows no antivirus" : "Defender reports real-time protection off"],
          title: "No virus protection is on", body: "Files you open or download aren't checked. Open Windows Security, Virus & threat protection, and turn on Real-time protection.",
          action: "Ask what to do", go: "chat", ask: "Windows says no virus protection is on. How do I turn it back on?",
        },
      };
    }
    return { state: "unknown", line: "Rig couldn't tell if virus protection is on", why: "Microsoft Defender answered without saying whether it's on.", action, ask: "How do I check that virus protection is on in Windows?" };
  }
  if (defenderOn) {
    const age = d?.signatureAgeDays;
    if (age != null && age > SIGNATURES_LOOK_DAYS) {
      return {
        state: "look", chip: `${age} days old`, line: `Microsoft Defender, on, updated ${agoWords(age)}`,
        why: `Defender checks files against a list of known viruses that it updates every day. Its list is ${age} days old, so it can miss new ones.`,
        steps: "Open Windows Security, Virus & threat protection, and under Protection updates choose Check for updates.",
        action: "Ask what to do", ask: `Microsoft Defender's virus definitions are ${age} days old. How do I get them updating again?`,
        finding: {
          id: "defender-signatures", weight: 15, severity: "warn", part: "windows", confidence: "sure", evidence: [`Virus definitions last updated ${age} days ago`],
          title: `Virus definitions are ${age} days old`, body: "Defender updates them every day, so new viruses can slip by. Open Windows Security, Virus & threat protection, and choose Check for updates.",
          action: "Ask what to do", go: "chat", ask: `Microsoft Defender's virus definitions are ${age} days old. How do I get them updating again?`,
        },
      };
    }
    const scan = d?.quickScanAgeDays;
    return {
      state: "ok", line: age != null ? `Microsoft Defender, on, updated ${agoWords(age)}` : "Microsoft Defender, on",
      why: `Defender checks files as you open them${scan != null ? `, and last scanned the ${w} ${agoWords(scan)}` : ""}.`,
      action, ask: `Is Microsoft Defender enough protection for my ${w}?`,
    };
  }
  const p = on[0];
  if (p.upToDate === false) {
    return {
      state: "look", chip: "Out of date", line: `${p.name}, on, out of date`,
      why: `${p.name} tells Windows its virus list is out of date, so it can miss new viruses.`,
      steps: `Open ${p.name} and run its update.`,
      action: "Ask what to do", ask: `${p.name} says it's out of date. How do I update it?`,
      finding: {
        id: "antivirus-old", weight: 10, severity: "warn", part: "windows", confidence: "sure", evidence: [`${p.name} reports it is out of date`],
        title: `${p.name} is out of date`, body: `Its virus list is behind, so new viruses can slip by. Open ${p.name} and run its update.`,
        action: "Ask what to do", go: "chat", ask: `${p.name} says it's out of date. How do I update it?`,
      },
    };
  }
  return { state: "ok", line: `${p.name}, on`, why: `${p.name} checks files as you open them, and tells Windows it's up to date.`, action, ask: `Is ${p.name} enough protection for my ${w}?` };
}

const PROFILES = [["domain", "work domain"], ["private", "private"], ["public", "public"]] as const;

function firewall(f: FirewallStatus | undefined, w: string): Check {
  const action = "Ask about it";
  const read = PROFILES.filter(([k]) => f?.[k] != null);
  if (!f || !read.length) {
    return { state: "unknown", line: "Rig couldn't read the firewall", why: "Windows Firewall didn't answer, so Rig can't say whether it's on.", action, ask: "How do I check that Windows Firewall is on?" };
  }
  const off = read.filter(([k]) => f[k] === false).map(([, w]) => w);
  const other = f.products?.find((p) => p.enabled && !/windows|defender/i.test(p.name));
  if (!off.length) {
    return {
      state: "ok", line: read.length === 3 ? "On for every network" : `On for ${list(read.map(([, w]) => w))} networks`,
      why: `Windows Firewall keeps other devices on your networks from reaching this ${w} uninvited.`,
      action, ask: `Is Windows Firewall set up well on my ${w}?`,
    };
  }
  const where = `${list(off)} networks`;
  if (other) {
    return { state: "ok", line: `${other.name}, on`, why: `Windows Firewall is off on ${where}, and ${other.name} looks after those instead.`, action, ask: `Is ${other.name} protecting my ${w} instead of Windows Firewall?` };
  }
  return {
    state: "look", chip: "Off", line: `Off on ${where}`,
    why: `Other devices on ${where} can reach this ${w} while the firewall is off there.`,
    steps: `Open Windows Security, Firewall & network protection, and turn it on for ${where}.`,
    action: "Ask what to do", ask: `Windows Firewall is off on ${where}. Should I turn it back on?`,
    finding: {
      id: "firewall-off", weight: 25, severity: "bad", part: "windows", confidence: "sure", evidence: [`Windows Firewall off on ${where}`],
      title: `Windows Firewall is off on ${where}`, body: `Other devices there can reach this ${w}. Open Windows Security, Firewall & network protection, and turn it on.`,
      action: "Ask what to do", go: "chat", ask: `Windows Firewall is off on ${where}. Should I turn it back on?`,
    },
  };
}

function backup(b: BackupStatus | undefined, now: number): Check {
  const action = "Ask about backup";
  if (!b || (b.oneDrive == null && b.fileHistoryAt == null)) {
    return { state: "unknown", line: "Rig couldn't tell", why: "Rig looks for File History and OneDrive's folder backup, and couldn't read either.", action, ask: "What's the easiest way to back up my files on Windows?" };
  }
  const parts: string[] = [];
  if (b.oneDrive?.length) parts.push(`OneDrive keeps ${list(b.oneDrive)}`);
  if (b.fileHistoryAt != null) parts.push(`File History copied ${agoWords(daysSince(b.fileHistoryAt, now))}`);
  if (parts.length) {
    return { state: "ok", line: parts.join(" · "), why: "A copy of your files lives somewhere else, so a failed drive doesn't take them with it.", action, ask: "Is my backup enough if my drive fails?" };
  }
  return {
    state: "none", line: "No File History or OneDrive folder backup",
    why: "Rig didn't see File History or OneDrive keeping a copy of your folders. Another backup app may still be doing it.",
    action, ask: "What's the easiest way to back up my files on Windows?",
  };
}

const TITLES: Record<SafetyId, string> = { updates: "Windows updates", antivirus: "Virus protection", firewall: "Firewall", backup: "Backup" };

function checks(s: SecurityFacts | undefined, now: number, kind?: PC["kind"]): [SafetyId, Check][] {
  const w = machineWord(kind);
  return [["updates", updates(s?.updates, now, w)], ["antivirus", antivirus(s?.antivirus, s?.defender, w)], ["firewall", firewall(s?.firewall, w)], ["backup", backup(s?.backup, now)]];
}

/** The four rows, in order. With nothing read, all four say so. */
export function safetyRows(s: SecurityFacts | undefined, now = Date.now(), kind?: PC["kind"]): SafetyRow[] {
  return checks(s, now, kind).map(([id, { finding: _f, ...c }]) => ({ id, title: TITLES[id], ...c }));
}

/** The health findings for what needs a look, under "Drivers and updates". None when nothing was read. */
export function safetyFindings(s: SecurityFacts | undefined, now = Date.now(), kind?: PC["kind"]): Finding[] {
  if (!s) return [];
  return checks(s, now, kind).flatMap(([, c]) => (c.finding ? [{ ...c.finding, category: "Drivers and updates" }] : []));
}

/** A short line for the whole section: how many need a look. */
export function safetySummary(rows: readonly SafetyRow[]): string {
  const look = rows.filter((r) => r.state === "look").length;
  if (look) return look === 1 ? "One thing needs a look" : `${look} things need a look`;
  if (rows.every((r) => r.state === "unknown")) return "Not read yet";
  return rows.some((r) => r.state === "unknown") ? "Nothing needs a look in what Rig could read" : "Nothing needs a look";
}
