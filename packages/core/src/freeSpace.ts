// Free up space: what on the PC is safe to clear, how much each frees, and how.
// The sizes come from the helper's quick read of the usual places Windows leaves
// files (`cleanup.sizes`, helper/RigHelper/Cleanup.cs); the games from the folder
// scan, and when each was last played from the recorded history. Pure, so the
// desktop, the demo and the tests agree.
//
// Rig clears none of these itself. Its shared rules make deleting files a change
// with no undo (Remove-Item is tier 3 in rules/commands.json), and they only take
// targets written out in full, never a folder's contents by pattern or by pipe, so
// there's no step Rig could check that empties these folders. Recipes (rules/recipes.json)
// only set registry values, policies and services. So each cleanup is steps the person
// follows in Windows' own tools, and the one change Rig offers is the Storage Sense
// recipe: a registry value it snapshots and puts back on undo.

import type { DriveMap, HistoryPoint } from "./model";
import { gamesOn } from "./roomForGames";
import type { RecipeStep } from "./shorthand";

/** The places the helper sizes. */
export type SpotKind = "recycleBin" | "userTemp" | "windowsTemp" | "updateCache" | "deliveryOptimization" | "windowsOld" | "thumbnails" | "crashDumps" | "oldDownloads";

/** One place and what it holds now, as the helper read it. */
export interface CleanupSpot {
  kind: SpotKind;
  /** Gigabytes, as Windows counts them (1024³ bytes). */
  gb: number;
  /** The drive it's on, "C:". */
  drive?: string;
  /** How many files, for old downloads. Never their names. */
  files?: number;
  /** The read ran out of time, so there's at least this much. */
  partial?: true;
}

/** The helper's answer to `cleanup.sizes`. Read-only. */
export interface CleanupSizes {
  /** When it was read, ms since 1970. */
  at: number;
  spots: CleanupSpot[];
  /** Whether Storage Sense is on for the person. Null or missing when Rig couldn't read it. */
  storageSense?: boolean | null;
}

/** What the free-up-space list is made from: the sizes, and when each game in the recorded history last played. */
export interface CleanupRead {
  sizes: CleanupSizes;
  /** Each game the history names, with when it last played (ms since 1970). */
  played: { name: string; lastPlayed: number }[];
  /** The oldest moment the history reaches back to, ms since 1970. Null when there's none. */
  historyFrom: number | null;
}

/** How a cleanup is done. Every one is steps the person follows; Storage Sense, the one change Rig makes, is offered on its own. */
export interface CleanupSteps {
  kind: "steps";
  steps: string[];
  /** Storage Sense clears this by itself once it's on. */
  storageSense?: true;
}

/** One thing to clear, for one row. */
export interface Cleanup {
  id: string;
  title: string;
  /** One plain line: what it is. */
  what: string;
  gb: number;
  /** Safe: Windows makes it again or no longer needs it. Look first: the person's own files or games. */
  safety: "safe" | "look";
  /** What to know before clearing it, when there's something. */
  note?: string;
  /** The drives it's on, "C:" or "C: and D:". */
  where?: string;
  /** At least this much: the helper ran out of time reading it. */
  partial?: true;
  how: CleanupSteps;
}

/** The one change Rig makes here: its Storage Sense recipe, reviewed, snapshotted and undone like any other. */
export interface StorageSenseOffer {
  step: RecipeStep;
  /** The rows it would keep clear by itself. */
  covers: string[];
}

export interface FreeSpacePlan {
  /** Safe ones first, then the ones to look at first; biggest first in each. */
  items: Cleanup[];
  /** What the safe ones free together, and the ones to look at first. */
  safeGb: number;
  lookGb: number;
  /** Offered while Storage Sense is off, or Rig couldn't tell. */
  storageSense: StorageSenseOffer | null;
}

const DAY = 864e5;
/** A game counts as unplayed after this long. */
export const UNPLAYED_DAYS = 90;
/** Smaller than this isn't worth a row. */
const MIN_GB = 0.1;
/** A game smaller than this isn't worth uninstalling for space. */
const MIN_GAME_GB = 1;

export const STORAGE_SENSE_ON: RecipeStep = { kind: "recipe", id: "storageSense", params: { state: "on" } };

const settingsTemp = "Open Settings, then go to System > Storage > Temporary files.";
const tick = (box: string) => `Tick ${box}, then choose Remove files.`;

/** Rig's words for each kind of place, and the steps in Windows' own tools that clear it. */
const KINDS: Record<Exclude<SpotKind, "userTemp" | "windowsTemp"> | "temp", Omit<Cleanup, "id" | "gb" | "where" | "partial">> = {
  windowsOld: {
    title: "Previous version of Windows",
    what: "A copy of your old Windows from the last big update. It's only for going back to that version.",
    safety: "safe",
    note: "Once it's gone you can't go back to the previous version of Windows. Windows also removes it by itself, usually 10 days after the update.",
    how: { kind: "steps", steps: [settingsTemp, tick("Previous Windows installation(s)")] },
  },
  temp: {
    title: "Temporary files",
    what: "Files apps and Windows left behind while they ran. They make new ones when they need them.",
    safety: "safe",
    note: "A file an app is still using is skipped, so clearing these never breaks an open app.",
    how: { kind: "steps", steps: [settingsTemp, tick("Temporary files")], storageSense: true },
  },
  updateCache: {
    title: "Windows Update files",
    what: "Updates Windows already downloaded. It fetches them again if it needs them.",
    safety: "safe",
    how: { kind: "steps", steps: ["Open Settings > Windows Update and finish any update that's waiting, restarting if it asks. Windows empties most of this once updates are in.", settingsTemp, tick("Windows Update Cleanup")] },
  },
  deliveryOptimization: {
    title: "Delivery Optimization files",
    what: "Pieces of updates Windows keeps to share with other PCs. Nothing on this PC needs them.",
    safety: "safe",
    how: { kind: "steps", steps: [settingsTemp, tick("Delivery Optimization Files")] },
  },
  recycleBin: {
    title: "Recycle Bin",
    what: "Files you deleted. They still take space until the bin is emptied.",
    safety: "safe",
    note: "Emptying it removes them for good, so look inside first if you're not sure.",
    how: { kind: "steps", steps: ["Open the Recycle Bin on the desktop and check nothing in it is still needed.", "Right-click the Recycle Bin and choose Empty Recycle Bin."], storageSense: true },
  },
  crashDumps: {
    title: "Crash reports",
    what: "Records Windows and apps saved when something crashed. Only needed to look into that crash.",
    safety: "safe",
    how: { kind: "steps", steps: ["Search Start for Disk Cleanup and open it.", "Choose Clean up system files, and pick drive C: if it asks.", "Tick System error memory dump files and System error minidump files, then choose OK."] },
  },
  thumbnails: {
    title: "Picture previews",
    what: "Small previews of your pictures and videos. File Explorer makes them again as you browse.",
    safety: "safe",
    how: { kind: "steps", steps: [settingsTemp, tick("Thumbnails")] },
  },
  oldDownloads: {
    title: "Old downloads",
    what: "Files in Downloads from more than 3 months ago.",
    safety: "look",
    note: "These are your own files, so Rig only counts them. Deleted files go to the Recycle Bin first, so you can still get one back until you empty it.",
    how: { kind: "steps", steps: ["Open File Explorer and choose Downloads.", "Choose Sort > Date modified, so the oldest come first.", "Delete the ones you don't need any more."] },
  },
};

const GAME_STEPS = [
  "Open the launcher you installed it with, like Steam, the Xbox app or Epic Games.",
  "Find it in your library and choose Uninstall. In Steam that's Manage > Uninstall.",
  "Check its saves first: most launchers keep them online, but not every game does.",
];
const GAME_NOTE = "Uninstall it from its launcher rather than deleting its folder, so the launcher knows it's gone and you can install it again later.";

const round1 = (gb: number) => Math.round(gb * 10) / 10;
/** "C:", "C: and D:", "C:, D: and E:". */
const joinDrives = (list: string[]) => (list.length <= 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
const fold = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const letterOf = (d: DriveMap) => d.volumes[0]?.match(/^[A-Z]:/i)?.[0].toUpperCase();

/** "4 months ago", "over a year ago". */
export function monthsAgo(ms: number): string {
  const months = Math.round(ms / DAY / 30.4);
  if (months >= 12) return "over a year ago";
  return `${Math.max(3, months)} months ago`;
}

/** The cleanups from Windows' own places: one row per kind, the two temp folders as one, each drive's Recycle Bin as one. */
function placeRows(spots: CleanupSpot[]): Cleanup[] {
  const groups = new Map<keyof typeof KINDS, CleanupSpot[]>();
  for (const s of spots) {
    if (!(s.gb > 0) || !Number.isFinite(s.gb)) continue;
    const key = s.kind === "userTemp" || s.kind === "windowsTemp" ? "temp" : s.kind;
    if (!(key in KINDS)) continue;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: Cleanup[] = [];
  for (const [key, list] of groups) {
    const gb = round1(list.reduce((n, s) => n + s.gb, 0));
    if (gb < MIN_GB) continue;
    const drives = [...new Set(list.map((s) => s.drive?.toUpperCase()).filter((d): d is string => !!d))].sort();
    const files = list.reduce((n, s) => n + (s.files ?? 0), 0);
    const base = KINDS[key];
    out.push({
      id: key, ...base, gb,
      ...(key === "oldDownloads" && files ? { what: `${files.toLocaleString("en-US")} ${files === 1 ? "file" : "files"} in Downloads from more than 3 months ago.` } : {}),
      ...(drives.length ? { where: joinDrives(drives) } : {}),
      ...(list.some((s) => s.partial) ? { partial: true as const } : {}),
    });
  }
  return out;
}

/**
 * Games the scan found that haven't been played in UNPLAYED_DAYS: last played that long ago, or not at all in a history
 * that reaches back that far. A history that doesn't reach back that far can't say, so those aren't listed.
 */
function gameRows(read: CleanupRead, drives: DriveMap[], now: number): Cleanup[] {
  const last = new Map<string, number>();
  for (const p of read.played) last.set(fold(p.name), Math.max(last.get(fold(p.name)) ?? 0, p.lastPlayed));
  const covers = read.historyFrom != null && now - read.historyFrom >= (UNPLAYED_DAYS - 1) * DAY;
  const out: Cleanup[] = [];
  const seen = new Set<string>();
  for (const d of drives) {
    for (const g of gamesOn(d)) {
      if (!g.name || g.gb < MIN_GAME_GB || seen.has(fold(g.name))) continue;
      const at = last.get(fold(g.name));
      const unplayed = at != null ? now - at >= UNPLAYED_DAYS * DAY : covers;
      if (!unplayed) continue;
      seen.add(fold(g.name));
      const where = letterOf(d);
      out.push({
        id: `game:${g.name}`, title: g.name, gb: round1(g.gb), safety: "look",
        what: at != null ? `Last played ${monthsAgo(now - at)}` : "Not played in the last 3 months",
        note: GAME_NOTE, ...(where ? { where } : {}),
        how: { kind: "steps", steps: GAME_STEPS },
      });
    }
  }
  return out;
}

const SPOT_KINDS = new Set<SpotKind>(["recycleBin", "userTemp", "windowsTemp", "updateCache", "deliveryOptimization", "windowsOld", "thumbnails", "crashDumps", "oldDownloads"]);
const DRIVE = /^[A-Z]:$/i;

/** The helper's answer with anything Rig doesn't know dropped: unknown places, sizes that aren't numbers, drive names that aren't a letter. */
export function cleanSizes(raw: unknown): CleanupSizes {
  const r = (raw ?? {}) as Partial<CleanupSizes>;
  const spots: CleanupSpot[] = [];
  for (const x of Array.isArray(r.spots) ? r.spots : []) {
    const s = (x ?? {}) as Partial<CleanupSpot>;
    if (!SPOT_KINDS.has(s.kind as SpotKind) || typeof s.gb !== "number" || !Number.isFinite(s.gb) || s.gb < 0) continue;
    spots.push({
      kind: s.kind as SpotKind, gb: s.gb,
      ...(typeof s.drive === "string" && DRIVE.test(s.drive) ? { drive: s.drive.toUpperCase() } : {}),
      ...(typeof s.files === "number" && Number.isInteger(s.files) && s.files >= 0 ? { files: s.files } : {}),
      ...(s.partial === true ? { partial: true as const } : {}),
    });
  }
  return { at: typeof r.at === "number" ? r.at : Date.now(), spots, storageSense: typeof r.storageSense === "boolean" ? r.storageSense : null };
}

/** When each game in the history last played, and how far back the history reaches. */
export function playedFrom(points: readonly HistoryPoint[]): Pick<CleanupRead, "played" | "historyFrom"> {
  const last = new Map<string, number>();
  let from: number | null = null;
  for (const p of points) {
    if (from == null || p.t < from) from = p.t;
    if (p.game) last.set(p.game, Math.max(last.get(p.game) ?? 0, p.t));
  }
  return { played: [...last].map(([name, lastPlayed]) => ({ name, lastPlayed })), historyFrom: from };
}

/** Everything safe to clear, then what to look at first, with what each frees and how. */
export function freeUpSpace(read: CleanupRead, drives: DriveMap[], now: number): FreeSpacePlan {
  const rows = [...placeRows(read.sizes.spots), ...gameRows(read, drives, now)];
  const bySize = (a: Cleanup, b: Cleanup) => b.gb - a.gb;
  const safe = rows.filter((r) => r.safety === "safe").sort(bySize);
  const look = rows.filter((r) => r.safety === "look").sort(bySize);
  const sum = (list: Cleanup[]) => round1(list.reduce((n, r) => n + r.gb, 0));
  const covers = safe.filter((r) => r.how.storageSense).map((r) => r.title);
  return {
    items: [...safe, ...look],
    safeGb: sum(safe),
    lookGb: sum(look),
    storageSense: read.sizes.storageSense === true ? null : { step: STORAGE_SENSE_ON, covers },
  };
}

/** Sizes the way the storage map writes them, with a decimal under 10 GB. */
export function spaceText(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  if (gb < 10) return `${(Math.round(gb * 10) / 10).toLocaleString("en-US")} GB`;
  return `${Math.round(gb).toLocaleString("en-US")} GB`;
}

/** The section's headline and the line under it. "About", since files come and go. */
export function freeSpaceWords(plan: FreeSpacePlan): { headline: string; detail: string } {
  const games = plan.items.some((r) => r.id.startsWith("game:")), downloads = plan.items.some((r) => r.id === "oldDownloads");
  const which = games && downloads ? "Games you haven't played and old downloads hold" : games ? "Games you haven't played hold" : "Old downloads hold";
  const more = plan.lookGb >= 1 ? ` ${which} ${spaceText(plan.lookGb)} more.` : "";
  if (plan.safeGb < 1) return { headline: "Not much to clear", detail: `Windows' own leftovers take less than 1 GB.${more}` };
  return { headline: `You could free about ${spaceText(Math.round(plan.safeGb))}`, detail: `From files Windows makes again or no longer needs.${more}` };
}
