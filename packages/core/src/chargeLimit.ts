// A laptop's battery charge limit: whether charging stops short of full, and
// for a laptop that sits on the charger at 100% most of the time, the offer
// to stop it at about 80%, which wears a battery more slowly. Rig sets it
// only on Dell and HP, through the firmware table's chargeLimit row (the same
// native op, card, approval and undo as any firmware setting). Every other
// maker sets it in its own app, which Rig names; Rig sends nothing to it.
// Windows has no standard read of the limit, so Rig also goes by what the
// battery does: held below full on the charger means a limit is on.

import type { BatteryNow } from "./battery";
import { FIRMWARE_MAKER_NAMES, FIRMWARE_MAKERS, FIRMWARE_SETTINGS, firmwareMakerOf, type FirmwareMaker, type FirmwareOp } from "./firmware";
import { makerName } from "./manualParts";
import type { HistoryPoint } from "./model";
import type { Inventory } from "./telemetry";

/** The firmware table's key for the charge limit. */
export const CHARGE_SETTING = "chargeLimit";

/** The charge limit as the helper's firmware read gives it, on a Dell or HP laptop whose maker tools answer. */
export interface ChargeRead {
  maker: FirmwareMaker;
  /** on: stops short of full. off: charges to full. other: a value Rig doesn't offer (Dell's Adaptive or Custom, say). */
  now: "on" | "off" | "other";
  /** Rig may turn it on here: no firmware password, drive encryption off, and the maker lets Windows change it. */
  canSet: boolean;
  /** Why Rig won't change it, in Rig's words from the read, when it won't. */
  why?: string;
}

/** The charge limit's row in the helper's firmware read (read_pc kind firmware), or null when the read has none. */
export function chargeReadOf(text: string | null | undefined): ChargeRead | null {
  let o: { maker?: unknown; settings?: unknown };
  try { o = JSON.parse(text ?? ""); } catch { return null; }
  const maker = FIRMWARE_MAKERS.find((m) => FIRMWARE_MAKER_NAMES[m] === o?.maker);
  const row = Array.isArray(o?.settings) ? (o.settings as Record<string, unknown>[]).find((r) => r?.setting === CHARGE_SETTING) : undefined;
  if (!maker || !row) return null;
  const now = row.now === "On" ? "on" : row.now === "Off" ? "off" : "other";
  const canSet = Array.isArray(row.canSet) && row.canSet.includes("on");
  return { maker, now, canSet, ...(!canSet && typeof row.why === "string" ? { why: row.why } : {}) };
}

/** Whether Rig's firmware table has a charge limit row for this laptop's maker, so the helper's read is worth asking for. */
export function chargeReadable(inv: Inventory): boolean {
  const maker = firmwareMakerOf(inv.machine.manufacturer);
  return inv.machine.kind === "laptop" && !!maker && !!FIRMWARE_SETTINGS[CHARGE_SETTING]?.makers[maker];
}

// ----- Where each maker sets it -----

/** Where a maker sets the limit itself, and the level its usual choice stops at, when it offers that one level. */
export interface ChargeApp {
  /** "MyASUS", "Lenovo Vantage", "firmware setup". */
  app: string;
  /** The setting's name there, when it's worth saying. */
  setting?: string;
  /** The level it stops at, percent. */
  at?: number;
}

const apps: [RegExp, ChargeApp | ((model: string) => ChargeApp)][] = [
  [/^asus/i, (model) => (/\b(rog|tuf|zephyrus|strix|scar|flow)\b/i.test(model) ? { app: "Armoury Crate", setting: "Battery Health Charging", at: 80 } : { app: "MyASUS", setting: "Battery Health Charging", at: 80 })],
  [/^lenovo/i, { app: "Lenovo Vantage" }],
  [/^dell/i, { app: "Dell Optimizer or Dell Power Manager" }],
  [/^(hp|hewlett)/i, { app: "firmware setup", setting: "Battery Health Manager", at: 80 }],
  [/^microsoft/i, { app: "the Surface app", setting: "Smart Charging", at: 80 }],
  [/^samsung/i, { app: "Samsung Settings", at: 85 }],
  [/^(micro-star|msi)/i, { app: "MSI Center", at: 80 }],
  [/^acer/i, { app: "Acer Care Center" }],
  [/^razer/i, { app: "Razer Synapse" }],
  [/^(gigabyte|aorus)/i, { app: "Gigabyte Control Center" }],
  [/^huawei/i, { app: "PC Manager" }],
  [/^framework/i, { app: "firmware setup" }],
];

/** Where this laptop's maker sets the charge limit. */
export function chargeApp(manufacturer: string | undefined, model = ""): ChargeApp {
  const m = (manufacturer ?? "").trim();
  const hit = apps.find(([re]) => re.test(m))?.[1];
  return typeof hit === "function" ? hit(model) : hit ?? { app: "your laptop maker's own app" };
}

// ----- What the battery does -----

const MIN = 60_000;
const WEEK = 7 * 864e5;
/** Three windows in a row: half an hour. */
const RUN = 3;
/** At or over this on the charger is full. */
const FULL = 97;

const plugged = (p: HistoryPoint): p is HistoryPoint & { batt: number } => p.drain == null && p.batt != null;

/**
 * The level the battery is held at on the charger, short of full, or null: plugged in and steady between 50% and 95%,
 * now or for half an hour in a row of the history. Rounded to 5, so 79% reads as 80%.
 */
export function heldAt(history: readonly HistoryPoint[], live?: BatteryNow | null): number | null {
  const round = (v: number) => Math.round(v / 5) * 5;
  const held = (v: number) => v >= 50 && v <= 95;
  if (live?.state === "plugged" && live.level != null && held(live.level)) return round(live.level);
  const pts = [...history].sort((a, b) => a.t - b.t);
  for (let i = pts.length - RUN; i >= 0; i--) {
    const run = pts.slice(i, i + RUN);
    if (!run.every(plugged)) continue;
    const levels = run.map((p) => p.batt!);
    const spanOk = run[RUN - 1].t - run[0].t <= (RUN + 1) * 10 * MIN;
    if (spanOk && levels.every(held) && Math.max(...levels) - Math.min(...levels) <= 2) return round(levels[RUN - 1]);
  }
  return null;
}

/** Whether the history shows it full on the charger for half an hour in a row: it charges all the way. */
function sitsFull(history: readonly HistoryPoint[]): boolean {
  const pts = [...history].sort((a, b) => a.t - b.t);
  let n = 0;
  for (const p of pts) { n = plugged(p) && p.batt >= FULL ? n + 1 : 0; if (n >= RUN) return true; }
  return false;
}

/** Over the last week's readings (only while it was awake): how many hours there are, and the share of them on the charger at full. */
export function fullOnCharger(history: readonly HistoryPoint[], now: number): { hours: number; share: number } {
  const week = history.filter((p) => p.t > now - WEEK && p.t <= now && p.batt != null);
  if (!week.length) return { hours: 0, share: 0 };
  const full = week.filter((p) => plugged(p) && p.batt >= FULL).length;
  return { hours: (week.length * 10) / 60, share: full / week.length };
}

/** At least this many hours of readings before Rig says how it's mostly used. */
const MIN_HOURS = 8;

// ----- The view -----

export interface ChargeOffer {
  /** "Stop charging at 80%". */
  title: string;
  /** The one grey line: why, and where it's set or when it applies. */
  meta: string;
  /** The firmware step Rig can make for it, on a Dell or HP where it may. Missing: it's set in the maker's own app. */
  op?: FirmwareOp;
  /** What Ask about it sends to the chat. */
  ask: string;
}

export interface ChargeLimitView {
  /** One line on the Battery life tab: "Charging stops at 80% to slow wear", "Charges to 100%". */
  line: string;
  /** The saver row, when it sits on the charger at full most of the time and no limit is on. */
  offer?: ChargeOffer;
}

/**
 * Whether this laptop's charging stops short of full, and what to do about it. Undefined when Rig can't tell either way.
 * `read` is the helper's firmware read, on a Dell or HP; everything else comes from the battery's own readings.
 */
export function chargeLimitView(inv: Inventory, live: BatteryNow | null, history: readonly HistoryPoint[], now: number, read?: ChargeRead | null): ChargeLimitView | undefined {
  if (inv.machine.kind !== "laptop") return undefined;
  const held = heldAt(history, live);
  const row = read ? FIRMWARE_SETTINGS[CHARGE_SETTING]?.makers[read.maker] : undefined;
  const on = read?.now === "on" || held != null;
  const off = !on && (read?.now === "off" || sitsFull(history) || (live?.state === "plugged" && (live.level ?? 0) >= 99));
  if (on) {
    const at = held ?? row?.stopsAt;
    return { line: at ? `Charging stops at ${at}% to slow wear` : "Charging stops short of full to slow wear" };
  }
  if (!off) return undefined;
  const { hours, share } = fullOnCharger(history, now);
  if (hours < MIN_HOURS || share < 0.5) return { line: "Charges to 100%" };
  const habit = "Plugged in at 100% most of the time.";
  const maker = makerName(inv.machine.manufacturer) || "the maker";
  if (read?.canSet && read.now === "off" && row) {
    const at = row.stopsAt;
    return {
      line: "Charges to 100%",
      offer: {
        title: at ? `Stop charging at ${at}%` : "Stop charging short of full",
        meta: `${habit} It applies at the next restart.`,
        op: { name: "firmware", setting: CHARGE_SETTING, value: "on", does: FIRMWARE_SETTINGS[CHARGE_SETTING].does!.on },
        ask: `My laptop is plugged in at 100% most of the time. Should I stop it charging ${at ? `at ${at}%` : "short of full"}?`,
      },
    };
  }
  const place = chargeApp(inv.machine.manufacturer, inv.machine.model);
  const at = place.at;
  return {
    line: "Charges to 100%",
    offer: {
      title: at ? `Stop charging at ${at}%` : "Stop charging short of full",
      meta: `${habit} ${read?.why ? `${read.why.replace(/\.$/, "")}: set` : "Set"} it in ${place.app}.`,
      ask: `My ${maker} laptop is plugged in at 100% most of the time. How do I make it stop charging ${at ? `at ${at}%` : "short of full"} in ${place.app}${place.setting ? ` (${place.setting})` : ""}?`,
    },
  };
}
