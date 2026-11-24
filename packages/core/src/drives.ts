// The storage map: each physical drive with what fills it and how healthy it is.
// Space comes from the volumes Windows reports and the helper's folder scan,
// health from the drive's own counters. Whatever Windows can't tell Rig is
// listed, not guessed.

import type { DriveFill, DriveMap, Severity } from "./model";
import type { Disk, FillKind, Inventory, Snapshot, StorageScan, Volume } from "./telemetry";
import { WEAR_CRITICAL, WEAR_LOW } from "./diagnose";

export const fillLabel: Record<DriveFill["kind"], string> = {
  windows: "Windows", apps: "Apps", games: "Games", files: "Your files", system: "Page and sleep files", other: "Other", free: "Free",
};

/** Shares under this size fold into Other, so the map shows what matters. */
const SMALL_GB = 1;

const usedOf = (v: Volume) => Math.max(0, v.sizeGb - v.freeGb);
const nameOf = (v: Volume) => (v.label ? `${v.letter} ${v.label}` : v.letter);

/** Which volumes sit on which drive: by disk number when the helper sends it, all of them on the only drive otherwise. */
export function placeVolumes(inv: Pick<Inventory, "disks" | "volumes">): { disk: Disk | null; volumes: Volume[] }[] {
  const placed = new Set<Volume>();
  const out: { disk: Disk | null; volumes: Volume[] }[] = inv.disks.map((d) => {
    const vols = d.number == null ? [] : inv.volumes.filter((v) => v.disk === d.number);
    vols.forEach((v) => placed.add(v));
    return { disk: d, volumes: vols };
  });
  const rest = inv.volumes.filter((v) => !placed.has(v));
  if (rest.length && out.length === 1 && out[0].volumes.length === 0) out[0].volumes = rest;
  else if (rest.length) out.push({ disk: null, volumes: rest });
  return out;
}

/** What fills these volumes, largest first, then Other and Free. Without a scan for them, just Used and Free. */
export function fillsOf(volumes: Volume[], scan: StorageScan | null | undefined): { fills: DriveFill[]; scanned: boolean } {
  const used = volumes.reduce((n, v) => n + usedOf(v), 0);
  const free = volumes.reduce((n, v) => n + v.freeGb, 0);
  const found = volumes.map((v) => scan?.volumes.find((s) => s.letter.toUpperCase() === v.letter.toUpperCase()));
  const scanned = volumes.length > 0 && found.every(Boolean);
  const freeFill: DriveFill = { kind: "free", label: fillLabel.free, gb: Math.round(free) };
  if (!scanned) return { fills: [{ kind: "other", label: "Used", gb: Math.round(used) }, freeFill], scanned: false };

  const many = volumes.length > 1;
  const byKind = new Map<FillKind, { gb: number; top: { name: string; gb: number }[] }>();
  found.forEach((s, i) => {
    for (const f of s!.fills) {
      const k = byKind.get(f.kind) ?? { gb: 0, top: [] };
      k.gb += f.gb;
      k.top.push(...(f.top ?? []).map((t) => ({ name: many ? `${t.name} (${volumes[i].letter})` : t.name, gb: t.gb })));
      byKind.set(f.kind, k);
    }
  });
  // Folders can count more than the drive holds (Windows shares files between its folders), so the shares never add up past what's used.
  const counted = [...byKind.values()].reduce((n, k) => n + k.gb, 0);
  const scale = counted > used && counted > 0 ? used / counted : 1;
  const fills: DriveFill[] = [];
  let other = used;
  for (const [kind, k] of byKind) {
    const gb = k.gb * scale;
    if (gb < SMALL_GB) continue;
    other -= gb;
    const top = k.top.filter((t) => t.gb >= SMALL_GB).sort((a, b) => b.gb - a.gb).slice(0, 5).map((t) => ({ name: t.name, gb: Math.round(t.gb * scale) }));
    fills.push({ kind, label: fillLabel[kind], gb: Math.round(gb), ...(top.length ? { top } : {}) });
  }
  fills.sort((a, b) => b.gb - a.gb);
  if (other >= SMALL_GB) fills.push({ kind: "other", label: fillLabel.other, gb: Math.round(other) });
  fills.push(freeFill);
  return { fills, scanned: true };
}

/** One verdict for a drive, worst first: Windows' own check, then wear, then errors it couldn't fix. */
export function driveHealth(d: Disk | null): { sev: Severity; text: string } {
  if (!d) return { sev: "info", text: "Rig can't tell which drive these are on" };
  if (d.status === "unhealthy") return { sev: "bad", text: "Windows says it's failing" };
  if (d.status === "warning") return { sev: "warn", text: "Windows sees a problem" };
  if (d.healthPercent != null && d.healthPercent < WEAR_CRITICAL) return { sev: "bad", text: "Nearly worn out" };
  if (d.healthPercent != null && d.healthPercent < WEAR_LOW) return { sev: "warn", text: "Wearing out" };
  if (d.errors) return { sev: "warn", text: `${d.errors.toLocaleString("en-US")} ${d.errors === 1 ? "error" : "errors"} it couldn't fix` };
  if (d.status === "healthy" || d.healthPercent != null) return { sev: "ok", text: "Healthy" };
  return { sev: "info", text: "No health reading" };
}

/** What Windows didn't tell Rig about a drive, in plain words. */
function unknownOf(d: Disk): string[] {
  const out: string[] = [];
  if (d.healthPercent == null) out.push(d.media === "hdd" ? "Wear: hard drives don't count it" : "Life left: this drive doesn't report it");
  if (d.writtenTb == null && d.media !== "hdd") out.push("Data written: not reported");
  if (d.powerOnHours == null) out.push("Hours powered on: not reported");
  if (d.status == null) out.push("Windows' health check: no answer");
  return out;
}

/** The drive's own temperature now: its main sensor when it names one. */
function tempOf(d: Disk, snap: Snapshot | null | undefined): number | undefined {
  const mine = (snap?.sensors ?? []).filter((x) => x.hw === "storage" && x.type === "temperature" && x.value != null && x.hwName.trim().toLowerCase() === d.model.trim().toLowerCase());
  const s = mine.find((x) => /^(composite |)temperature$/i.test(x.name)) ?? mine[0];
  return s?.value == null ? undefined : Math.round(s.value);
}

/** Every drive for the storage map, Windows' drive first. */
export function driveMaps(inv: Pick<Inventory, "disks" | "volumes">, scan: StorageScan | null | undefined, snap?: Snapshot | null): DriveMap[] {
  const maps = placeVolumes(inv).map(({ disk, volumes }): DriveMap => {
    const { fills, scanned } = fillsOf(volumes, scan);
    const hasVol = volumes.length > 0;
    const winGb = fills.find((f) => f.kind === "windows")?.gb ?? 0;
    return {
      model: disk?.model ?? "Other drives",
      media: disk?.media ?? "unknown",
      sizeGb: Math.round(disk?.sizeGb ?? volumes.reduce((n, v) => n + v.sizeGb, 0)),
      volumes: volumes.map(nameOf),
      system: winGb > 0 || volumes.some((v) => v.letter.toUpperCase() === "C:"),
      ...(hasVol ? { usedGb: Math.round(volumes.reduce((n, v) => n + usedOf(v), 0)), freeGb: Math.round(volumes.reduce((n, v) => n + v.freeGb, 0)) } : {}),
      fills: hasVol ? fills : [],
      ...(scanned && scan?.at ? { scannedAt: new Date(scan.at).toISOString() } : {}),
      ...(scan?.running && hasVol ? { scanning: true } : {}),
      health: driveHealth(disk),
      ...(disk?.healthPercent != null ? { lifeLeft: disk.healthPercent } : {}),
      ...(disk?.writtenTb != null ? { writtenTb: disk.writtenTb } : {}),
      ...(disk?.powerOnHours != null ? { powerOnHours: disk.powerOnHours } : {}),
      ...(disk?.errors ? { errors: disk.errors } : {}),
      ...(disk && tempOf(disk, snap) != null ? { temp: tempOf(disk, snap) } : {}),
      unknown: disk ? unknownOf(disk) : ["Which drive these volumes are on"],
    };
  });
  return maps.sort((a, b) => Number(b.system) - Number(a.system));
}
