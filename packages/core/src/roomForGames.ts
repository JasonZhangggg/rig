// Free space in games the person actually has: "Room for about 4 more big games".
// Each drive's free space is counted in installs of the biggest game on it (or on the PC,
// when that drive holds none), and a drive with a roomier neighbour gets one game it could move there.
// Only games the folder scan found are used; without any, there's no count, not a guess.

import type { DriveMap } from "./model";

/** A game from the folder scan. `name` is null when its folder doesn't say which game it is. */
export interface GameSize { name: string | null; gb: number }

/** A drive's free space, counted in one game's installs. */
export interface Room {
  freeGb: number;
  /** The game it's counted in: the biggest on this drive, or on the PC when this drive has none. */
  ref: GameSize;
  /** Over 50 GB: a "big game". */
  big: boolean;
  /** Whole installs that fit, and what's left over after them. */
  count: number;
  spareGb: number;
}

/** One game to move to a roomier drive, and what that frees. */
export interface MoveOne {
  game: { name: string; gb: number };
  /** The roomier drive, as its letter ("D:") or its model when it has none. */
  to: string;
  /** More games of the reference size that fit here afterwards (0 when it frees less than one). */
  gain: number;
  /** Load times there: a game moved from an SSD to a hard drive most likely loads slower, and the other way faster. */
  speed?: "slower" | "faster";
}

const BIG_GB = 50;
/** Smaller than this isn't worth counting in, or moving. */
const MIN_GB = 1;

/** Folders the scan files under games that aren't one game: launchers' leftovers and their library roots. */
const notAGame = /(^|\s)extras$|^(riot games|steamlibrary|steamapps|common|xboxgames|epic games|gog games|gog galaxy|steam|origin games|ea games|ubisoft game launcher|battle\.net)$/i;
/** A folder name that is an install id rather than a title, like the Xbox app's "Microsoft.624F8B84B80_8wekyb3d8bbwe". */
const idLike = (s: string) => !/\s/.test(s) && /[._]/.test(s) && s.length > 12 && /\d/.test(s);

/**
 * What the scan calls a game, made fit to show: the drive letter Rig adds on drives with several volumes comes off.
 * `undefined` when it isn't a game at all (a launcher's extras), `null` when it's a game whose folder doesn't name it.
 */
export function gameTitle(raw: string): string | null | undefined {
  const name = raw.replace(/\s*\([A-Z]:\)$/i, "").trim();
  if (!name || notAGame.test(name)) return undefined;
  if (idLike(name)) return null;
  return name;
}

/** The games the scan named on a drive, biggest first. */
export function gamesOn(d: DriveMap): GameSize[] {
  const top = d.fills.find((f) => f.kind === "games")?.top ?? [];
  const out: GameSize[] = [];
  for (const t of top) {
    const name = gameTitle(t.name);
    if (name === undefined || !(t.gb >= MIN_GB)) continue;
    out.push({ name, gb: t.gb });
  }
  return out.sort((a, b) => b.gb - a.gb);
}

/** The game to count in: the biggest one with a name, else the biggest one at all. */
function biggest(games: GameSize[]): GameSize | null {
  return games.find((g) => g.name) ?? games[0] ?? null;
}

/** How many more of the person's games fit in a drive's free space. Null when Rig has no free space or no games to count in. */
export function roomFor(d: DriveMap, all: DriveMap[]): Room | null {
  if (d.freeGb == null || !d.fills.length) return null;
  const ref = biggest(gamesOn(d)) ?? biggest(all.flatMap(gamesOn).sort((a, b) => b.gb - a.gb));
  if (!ref) return null;
  const count = Math.max(0, Math.floor(d.freeGb / ref.gb));
  return { freeGb: d.freeGb, ref, big: ref.gb >= BIG_GB, count, spareGb: Math.max(0, Math.round(d.freeGb - count * ref.gb)) };
}

const letterOf = (d: DriveMap) => d.volumes[0]?.match(/^[A-Z]:/i)?.[0].toUpperCase() ?? d.model;
const fast = (d: DriveMap) => d.media === "nvme" || d.media === "ssd";

/**
 * The single biggest named game on this drive that fits on the roomiest other drive, when there's one with more free space.
 * Null on a drive with nowhere roomier, or nothing that fits there.
 */
export function moveOne(d: DriveMap, all: DriveMap[]): MoveOne | null {
  const room = roomFor(d, all);
  if (!room) return null;
  const roomier = all.filter((o) => o !== d && o.freeGb != null && o.freeGb > room.freeGb).sort((a, b) => b.freeGb! - a.freeGb!)[0];
  if (!roomier) return null;
  const game = gamesOn(d).find((g): g is { name: string; gb: number } => !!g.name && g.gb < roomier.freeGb!);
  if (!game) return null;
  const gain = Math.floor((room.freeGb + game.gb) / room.ref.gb) - room.count;
  const speed = fast(d) && roomier.media === "hdd" ? "slower" : d.media === "hdd" && fast(roomier) ? "faster" : undefined;
  return { game, to: letterOf(roomier), gain, ...(speed ? { speed } : {}) };
}

const gbText = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb).toLocaleString("en-US")} GB`);

/** The drive's headline and the line under it, in plain words. "About" goes on the count, since games differ in size. */
export function roomWords(r: Room): { headline: string; detail: string } {
  const what = r.big ? "big games" : r.ref.name ? `games like ${r.ref.name}` : "games";
  const one = r.big ? "big game" : r.ref.name ? `game like ${r.ref.name}` : "game";
  const the = r.ref.name ?? "your biggest game";
  const free = `${gbText(r.freeGb)} free`;
  if (r.count === 0) return { headline: `Not enough room for another ${one}`, detail: `${free}, less than ${the} takes (${gbText(r.ref.gb)}).` };
  const headline = r.count === 1 ? `Room for about one more ${one}` : `Room for about ${r.count.toLocaleString("en-US")} more ${what}`;
  const installs = `${r.count.toLocaleString("en-US")} ${r.count === 1 ? "install" : "installs"} the size of ${the} (${gbText(r.ref.gb)})`;
  return { headline, detail: `${free}: ${installs}${r.spareGb >= MIN_GB ? `, with ${gbText(r.spareGb)} to spare` : ""}.` };
}
