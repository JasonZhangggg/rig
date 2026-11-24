// The demo's background recorder: a week of Atlas's log, written the way the
// recorder service writes it (a sensor list, then a line of readings every 30
// seconds, Windows events, and a closer look around anything unusual), and
// read back through the same BackgroundLog a real PC uses.

import { BackgroundLog, backgroundRecordings } from "../background";
import { customRecordings, CustomLog, type ProbeSpec, type ProbeStatus } from "../probes";
import type { Limits, Recording } from "../recordings";
import type { Inventory, Snapshot } from "../telemetry";
import { demoEvents, demoProcesses, hotEvening } from "./logs";
import type { Activity } from "./schedule";
import { simulate } from "./simulate";

const SEC = 1000, MIN = 60_000, DAY = 864e5;
/** What the recorder keeps: every temperature, load, fan, power, level and fan-control sensor, but no drives. */
const kept = new Set(["temperature", "load", "fan", "power", "level", "control"]);
const GPU_HOT = 88;
const LOOK_MS = 3 * MIN;

export const DEMO_PROBE_ID = "discord-mem";

/** A week of the recorder's lines for a demo PC, oldest first. Only Atlas has the recorder on. */
export function demoRecorderLines(inv: Inventory, now: number, dust: number): unknown[] {
  if (inv.machine.kind !== "tower") return [];
  const from = new Date(now - 7 * DAY); from.setHours(0, 0, 0, 0);
  const hot = hotEvening(now);
  // That Wednesday's Cyberpunk evening: the card creeps up as the dust takes hold, the way the finished recording shows it.
  const session = { from: hot - 100 * MIN, to: hot + 140 * MIN };
  const game: Activity = { cpu: 0.7, gpu: 1, game: "Cyberpunk 2077" };
  const read = (t: number): Snapshot => t >= session.from && t <= session.to
    ? simulate(inv, t, { activity: game, dust: -0.35 + Math.min(1, Math.max(0, (t - session.from) / (130 * MIN))) * 0.99 })
    : simulate(inv, t, { dust });
  const sensors = read(from.getTime()).sensors.filter((s) => kept.has(s.type) && s.hw !== "storage");
  const ids = sensors.map((s) => s.id);
  const gpuCore = sensors.findIndex((s) => s.hw === "gpu" && s.type === "temperature");
  const line = (t: number, d: boolean) => {
    const by = new Map(read(t).sensors.map((s) => [s.id, s.value]));
    const v = ids.map((id) => by.get(id) ?? null);
    return { k: "s", t, v, ...(d ? { d: 1 } : {}), ...(t % MIN < 30 * SEC ? { top: demoProcesses(inv, t) } : {}) };
  };

  // The recorder reads every 30 seconds, but a day's log shows one reading every 4 minutes, so the demo writes only
  // those, and one every 8 minutes before yesterday, to keep the demo quick to start.
  const yesterday = new Date(now - DAY); yesterday.setHours(0, 0, 0, 0);
  const base: ReturnType<typeof line>[] = [];
  for (let t = from.getTime(); t <= now; t += t < yesterday.getTime() ? 8 * MIN : 4 * MIN) base.push(line(t, false));

  // Closer looks: the graphics card at 88°C or more two readings running (once a day at most), and the Windows events that start one.
  const events = demoEvents(inv.machine.kind, now, from.getTime()).sort((a, b) => a.t - b.t);
  const looks: { t: number; why: string; text: string }[] = [];
  const day = (t: number) => new Date(t).toDateString();
  base.forEach((l, i) => {
    const g = l.v[gpuCore], p = base[i - 1]?.v[gpuCore];
    if (g == null || p == null || g < GPU_HOT || p < GPU_HOT) return;
    if (looks.some((x) => x.why === "gpu-hot" && day(x.t) === day(l.t))) return;
    looks.push({ t: l.t, why: "gpu-hot", text: `The graphics card reached ${Math.round(g)}°C` });
  });
  for (const e of events) {
    if (e.level === "info" || looks.some((l) => Math.abs(l.t - e.t) < 5 * MIN)) continue;
    looks.push({ t: e.t, why: "event", text: `Windows logged ${e.source} event ${e.id}` });
  }

  // Every 5 seconds from 5 minutes before a closer look to 3 minutes after it.
  const close = (t: number) => looks.some((l) => t >= l.t - 5 * MIN && t <= l.t + LOOK_MS);
  const lines: unknown[] = [{ k: "sensors", t: from.getTime(), list: sensors.map((s) => [s.id, s.hw, s.hwName, s.type, s.name]) }];
  for (const l of base) if (!close(l.t)) lines.push(l);
  for (const l of looks) for (let t = Math.ceil((l.t - 5 * MIN) / (5 * SEC)) * 5 * SEC; t <= Math.min(now, l.t + LOOK_MS); t += 5 * SEC) lines.push(line(t, true));
  for (const l of looks) lines.push({ k: "anomaly", t: l.t, why: l.why, text: l.text });
  for (const e of events) lines.push({ k: "e", t: e.t, log: e.log, source: e.source, id: e.id, level: e.level, message: e.message });
  return lines.sort((a, b) => (a as { t: number }).t - (b as { t: number }).t);
}

/** The custom log Rig's chat set up after Discord crashed: its memory and processor use every 30 seconds while it runs. */
export function demoProbe(inv: Inventory, now: number): { lines: unknown[]; status: ProbeStatus[] } {
  if (inv.machine.kind !== "tower") return { lines: [], status: [] };
  const crash = demoEvents("tower", now).find((e) => /discord/i.test(e.message));
  if (!crash) return { lines: [], status: [] };
  const start = crash.t + 25 * MIN;
  const spec: ProbeSpec = {
    id: DEMO_PROBE_ID, label: "Discord's memory and processor use, to see if its memory keeps growing", by: "chat",
    createdAt: start, expiresAt: start + 7 * DAY, every: 30, source: { kind: "process", name: "Discord.exe" },
  };
  const lines: unknown[] = [{ k: "probe", t: start, id: spec.id, what: "on", spec }];
  // Discord holds a little more memory every hour it stays open, and starts small again each morning.
  for (let t = start; t <= now; t += 30 * SEC) {
    const d = new Date(t);
    const open = d.getHours() >= 8 || d.getHours() < 1;
    if (!open) continue;
    const since = d.getHours() >= 8 ? (d.getHours() - 8) * 60 + d.getMinutes() : (d.getHours() + 16) * 60 + d.getMinutes();
    const wob = Math.sin(t / 7000) * 12;
    lines.push({ k: "p", t, id: spec.id, v: { running: true, count: 6, cpu: Math.round((1.1 + Math.abs(Math.sin(t / 50_000)) * 1.8) * 10) / 10, memMb: Math.round(380 + since * 1.9 + wob) } });
  }
  return { lines, status: [{ id: spec.id, label: spec.label, kind: "process", by: "chat", createdAt: spec.createdAt, expiresAt: spec.expiresAt, every: 30, state: "on", lastT: now }] };
}

/** Atlas's background recordings for the demo: a closer look around anything unusual, each day, and the custom log. */
export function demoBackground(inv: Inventory, now: number, dust: number, limits: Limits): Recording[] {
  // Every demo client in a page or a test file shares one week, made again every few minutes so today keeps up.
  const key = `${inv.machine.id}|${dust}|${limits.cpu}|${limits.gpu}`;
  const hit = made.get(key);
  if (hit && Math.abs(now - hit.at) < 5 * MIN) return hit.recs;
  const recs = makeBackground(inv, now, dust, limits);
  made.set(key, { at: now, recs });
  return recs;
}

const made = new Map<string, { at: number; recs: Recording[] }>();

function makeBackground(inv: Inventory, now: number, dust: number, limits: Limits): Recording[] {
  const log = new BackgroundLog();
  log.ingest(demoRecorderLines(inv, now, dust));
  const probe = demoProbe(inv, now);
  const custom = new CustomLog();
  custom.ingest(probe.lines);
  return [...backgroundRecordings(log, inv.machine.id, limits, now), ...customRecordings(custom, inv.machine.id, now, probe.status)];
}
