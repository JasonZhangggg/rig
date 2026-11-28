// "Why is my PC slow or loud?", answered on the spot from Rig's own readings: how hard each part works and how warm
// it is, the fans, memory, the drive, the busiest apps and the last hour of history. No chat round trip, so it can only
// say what the numbers show; where a cause is a reading of the signs rather than a reading itself, it's marked likely.
// Pure, so the desktop, the website and the demo give the same answer from the same readings.

import type { ActionCall } from "./actions";
import type { HistoryPoint, Issue, PC, Route } from "./model";
import type { ProcessUse } from "./recordings";
import { machineWord } from "./machineWord";

/** What to do about a cause: an existing finding (its fix or its own action), a change to review, a place in Rig, or a question for the chat. */
export type SlowLoudStep =
  | { kind: "issue"; label: string; issue: Issue }
  | { kind: "fix"; label: string; fix: ActionCall[]; why: string }
  | { kind: "go"; label: string; route: Route; part?: string }
  | { kind: "ask"; label: string; ask: string }
  /** Something only the person can do, like plugging in: said in place of a button. */
  | { kind: "tip"; label: string };

export interface SlowLoudCause {
  id: string;
  /** The cause in a short line: "Cyberpunk 2077 keeps the graphics card at 97%". */
  title: string;
  /** The numbers it rests on, in one grey line. */
  evidence: string;
  /** What it means, for Details. */
  why?: string;
  /** The signs point to it, but no reading shows it outright. */
  likely?: boolean;
  step: SlowLoudStep;
}

export interface SlowLoudAnswer {
  headline: string;
  /** Nothing looks wrong. */
  calm: boolean;
  /** The fans are running fast. */
  loud: boolean;
  /** Up to three, the likeliest first. */
  causes: SlowLoudCause[];
  /** What Rig looked at, one short line each, for when nothing looks wrong. */
  checked: string[];
  /** Why the busiest apps aren't part of the answer, when they aren't. */
  appsNote?: string;
  /** Said when the readings aren't live, like a PC that's offline. */
  asOf?: string;
}

export interface SlowLoudInput {
  pc: PC;
  /** Recorded history; only the last hour is read. */
  history?: readonly HistoryPoint[];
  /** The busiest apps right now. Null when they can't be read from here (the website), missing when not read. */
  processes?: readonly ProcessUse[] | null;
  /** Milliseconds since epoch. */
  now?: number;
}

// ----- Thresholds -----

/** A part at or over this load, in percent, counts as kept busy. */
export const SL_BUSY = 80;
/** With the fans loud, a part this busy is enough to be what they're cooling. */
export const SL_BUSY_LOUD = 60;
/** Memory this full, in percent, makes apps wait on the drive. */
export const SL_MEM_FULL = 90;
/** A drive this busy, in percent of the time, makes everything wait on it. */
export const SL_DISK_BUSY = 80;
/** Within this many degrees of its limit a part slows itself down to stay safe. */
export const SL_AT_LIMIT = 2;
/** A processor this close to its limit while at rest points at the cooler. */
export const SL_WARM_AT_REST = 8;
/** At or under this load a part counts as at rest. */
export const SL_REST = 30;
/** Fan speeds that sound loud: desktops' fans are bigger and slower than a laptop's. */
export const SL_LOUD_RPM = { tower: 1600, laptop: 3800 } as const;
/** Enough startup apps to slow the start. */
export const SL_STARTUP = 8;
/** A background job worth naming once it takes this share of the processor. */
export const SL_BACKGROUND_CPU = 8;

/** On battery, a processor cap under this, in percent, holds a laptop back. Rig's own battery saver sets 99, which only turns off boost. */
export const SL_BATTERY_CAP = 90;
/** An app using this much of a laptop's built-in graphics, and none of its graphics card, runs on the wrong chip. */
export const SL_BUILT_IN = 40;

/** How many of the busiest apps the check reads. */
export const SLOW_LOUD_APPS = 8;

const HOUR = 60 * 60_000;

// ----- Apps -----

type Background = "scan" | "update" | "index" | "check";
/** Windows' own background work, by process name. */
const BACKGROUND: [RegExp, string, Background][] = [
  [/^(msmpeng|mpdefendercoreservice|nissrv|mpcmdrun)\.exe$/i, "Windows Security", "scan"],
  [/^(tiworker|trustedinstaller|mousocoreworker|wuauclt|usoclient|wudfhost|setuphost)\.exe$/i, "Windows Update", "update"],
  [/^(searchindexer|searchprotocolhost|searchfilterhost)\.exe$/i, "Windows Search", "index"],
  [/^compattelrunner\.exe$/i, "Windows' compatibility check", "check"],
];
const KNOWN: [RegExp, string][] = [
  [/^chrome\.exe$/i, "Chrome"], [/^msedge\.exe$/i, "Edge"], [/^firefox\.exe$/i, "Firefox"], [/^opera\.exe$/i, "Opera"],
  [/^discord\.exe$/i, "Discord"], [/^(ms-teams|teams)\.exe$/i, "Teams"], [/^slack\.exe$/i, "Slack"], [/^spotify\.exe$/i, "Spotify"],
  [/^(steam|steamwebhelper)\.exe$/i, "Steam"], [/^excel\.exe$/i, "Excel"], [/^winword\.exe$/i, "Word"], [/^outlook\.exe$/i, "Outlook"],
  [/^onedrive\.exe$/i, "OneDrive"], [/^obs64\.exe$/i, "OBS"], [/^explorer\.exe$/i, "File Explorer"],
  [/^cs2\.exe$/i, "Counter-Strike 2"], [/^bg3(_dx11)?\.exe$/i, "Baldur's Gate 3"], [/^javaw\.exe$/i, "Java"],
];

const backgroundOf = (p: ProcessUse) => BACKGROUND.find(([re]) => re.test(p.name));
/** Apps that belong on the built-in graphics: the desktop, browsers, chat and office apps. */
const NOT_GAMES = /^(dwm|explorer|chrome|msedge|firefox|opera|brave|ms-teams|teams|discord|slack|spotify|zoom|steam|steamwebhelper|code|excel|winword|outlook|powerpnt|onedrive|vlc|applicationframehost|searchhost|startmenuexperiencehost|textinputhost|rig|righelper)\.exe$/i;

/** The name a person knows an app by: its own name where Rig knows it, else the program's file name. */
export function appName(p: Pick<ProcessUse, "name">): string {
  const bg = BACKGROUND.find(([re]) => re.test(p.name));
  if (bg) return bg[1];
  const known = KNOWN.find(([re]) => re.test(p.name));
  if (known) return known[1];
  // "Cyberpunk2077.exe" reads as "Cyberpunk 2077".
  return p.name.replace(/\.exe$/i, "").replace(/([a-z])(\d{3,})$/i, "$1 $2");
}

const BG_DOING: Record<Background, string> = { scan: "is scanning in the background", update: "is installing updates in the background", index: "is indexing files in the background", check: "is running in the background" };

// ----- Words -----

const r = Math.round;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rpm = (n: number) => `${r(n).toLocaleString("en-US")} rpm`;
const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
const pctOf = (n: number) => `${r(n)}%`;
/** A graphics chip's short name: "Radeon 780M", "RTX 4060". Undefined when what's left names no model. */
const chipShort = (n: string | undefined) => {
  const s = n?.replace(/\((tm|r)\)|[®™]/gi, " ").replace(/^\s*(NVIDIA|AMD|Intel)\s+/i, "").replace(/^GeForce\s+/i, "").replace(/\s+(Laptop GPU|Graphics|GPU)\s*$/i, "").replace(/\s+/g, " ").trim();
  return s && /\d/.test(s) ? s : undefined;
};
/** What Windows calls its battery saver: Energy saver from Windows 11 24H2 on. */
const saverName = (os: string) => (/windows 11/i.test(os) && /\b(2[4-9]|[3-9]\d)h\d\b/i.test(os) ? "Energy saver" : "Battery saver");

interface Candidate extends SlowLoudCause {
  score: number;
  /** It makes noise: heat or a part kept busy. Memory or a capped processor doesn't. */
  noisy: boolean;
}

export function slowOrLoud({ pc, history = [], processes, now = Date.now() }: SlowLoudInput): SlowLoudAnswer {
  const parts = pc.parts ?? {};
  const cpu = parts.cpu, gpu = parts.gpu, ram = parts.ram;
  const laptop = pc.kind === "laptop";
  const word = machineWord(pc.kind);
  const issues = pc.issues ?? [];
  const issue = (...ids: string[]) => issues.find((i) => ids.includes(i.id));
  const issueStep = (i: Issue): SlowLoudStep => ({ kind: "issue", label: i.fix ? "Review change" : i.action, issue: i });

  const apps = processes ?? [];
  const byCpu = [...apps].sort((a, b) => b.cpu - a.cpu);
  const byGpu = [...apps].filter((p) => (p.gpu ?? 0) > 0).sort((a, b) => (b.gpu ?? 0) - (a.gpu ?? 0));
  const byMem = [...apps].sort((a, b) => b.memMb - a.memMb);
  const recent = history.filter((p) => p.t <= now && now - p.t <= HOUR);
  const lastGame = [...recent].sort((a, b) => b.t - a.t).find((p) => p.game)?.game ?? null;
  /** The app's name, or the game's own name from the history when the program is plainly that game ("Cyberpunk2077_x64.exe"). */
  const squash = (s: string) => s.toLowerCase().replace(/\.exe$/, "").replace(/[^a-z0-9]/g, "");
  const nameOf = (p: ProcessUse) => (lastGame && squash(p.name).startsWith(squash(lastGame)) ? lastGame : appName(p));

  // Readings now
  const cpuLoad = cpu?.load, cpuT = cpu?.temp, cpuLim = cpu?.limit;
  const gpuLoad = gpu?.load, gpuT = gpu?.temp, gpuLim = gpu?.limit;
  const mem = ram?.load;
  const disk = (pc.readings ?? []).filter((x) => x.part === "ssd" && x.type === "load" && /total activity/i.test(x.name) && x.value != null).reduce<number | null>((m, x) => Math.max(m ?? 0, x.value!), null);
  const fans = pc.fans ?? [];
  const fastest = fans.reduce<(typeof fans)[number] | null>((m, f) => (!m || f.rpm > m.rpm ? f : m), null);
  const loud = !!fastest && fastest.rpm >= SL_LOUD_RPM[laptop ? "laptop" : "tower"];
  const fanWords = fastest ? `${fastest.label === "Graphics" ? "graphics card fans" : "fans"} at ${rpm(fastest.rpm)}` : "";

  const out: Candidate[] = [];
  const add = (c: Candidate) => { if (!out.some((x) => x.id === c.id)) out.push(c); };

  // The processor hot while it barely works: the cooler, not the load.
  const hotIdle = issue("cpu-hot-idle") ?? (issue("cpu-hot")?.confidence === "likely" ? issue("cpu-hot") : undefined);
  if (cpuT != null && cpuLim != null && cpuLoad != null && cpuLoad <= SL_REST && cpuT >= cpuLim - SL_WARM_AT_REST) {
    const found = hotIdle ?? issue("cpu-hot", "cpu-warm");
    add({
      id: "cpu-hot-rest", score: 95, noisy: true, likely: true,
      title: "Processor is hot while barely working",
      evidence: `${r(cpuT)}°C at ${pctOf(cpuLoad)} busy · limit ${cpuLim}°C`,
      why: laptop
        ? "A processor at rest should run well under its limit. On a laptop that points at the cooling: dust in the fan, vents blocked by a soft surface, or a fan that stopped."
        : "A processor at rest should run well under its limit. That points at the cooler: a fan or pump that stopped, a cooler that came loose, or dried-out paste.",
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what to do", ask: laptop ? `My laptop's processor is at ${r(cpuT)}°C while only ${pctOf(cpuLoad)} busy. Is something wrong with its fan?` : `My processor is at ${r(cpuT)}°C while only ${pctOf(cpuLoad)} busy. Is the cooler failing?` },
    });
  } else if (hotIdle) {
    add({ id: "cpu-hot-rest", score: 85, noisy: true, likely: true, title: hotIdle.title, evidence: hotIdle.evidence?.[0] ?? hotIdle.body, why: hotIdle.body, step: issueStep(hotIdle) });
  }

  // A part at its limit slows itself down to stay safe, and its fans run flat out.
  if (cpuT != null && cpuLim != null && cpuT >= cpuLim - SL_AT_LIMIT && (cpuLoad == null || cpuLoad > SL_REST)) {
    const found = issue("cpu-hot");
    // A laptop's processor is built to work at its limit. Without a finding (it hasn't lost real speed there) that's how it runs, not a fault.
    if (laptop && !found && cpuLoad != null) add({
      id: "cpu-limit", score: 60, noisy: true,
      title: `Processor is working at its ${cpuLim}°C limit`,
      evidence: `${r(cpuT)}°C at ${pctOf(cpuLoad)} busy`,
      why: "Laptop processors are built to run up to their limit under load. There they slow down a little to stay safe, which is called throttling, and the fans run fast. That's normal.",
      step: { kind: "ask", label: "Ask about it", ask: `My laptop's processor runs at ${r(cpuT)}°C under load. Is that normal, and can I make it quieter?` },
    });
    else add({
      id: "cpu-limit", score: 78, noisy: true,
      title: `Processor is at its ${cpuLim}°C limit`,
      evidence: `${r(cpuT)}°C${cpuLoad != null ? ` at ${pctOf(cpuLoad)} busy` : ""}`,
      why: "At its limit it gives up some speed to stay safe, which is called throttling, and its fan runs flat out.",
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what to do", ask: `My processor is at ${r(cpuT)}°C. What should I do?` },
    });
  }
  if (gpuT != null && gpuLim != null && gpuT >= gpuLim - SL_AT_LIMIT) {
    const found = issue("gpu-hot", "gpu-hotspot-hot");
    add({
      id: "gpu-limit", score: 78, noisy: true,
      title: `Graphics card is at its ${gpuLim}°C limit`,
      evidence: `${r(gpuT)}°C${gpuLoad != null ? ` at ${pctOf(gpuLoad)} busy` : ""}`,
      why: `At its limit it gives up some speed to stay safe, which is called throttling, and its fans run flat out. ${laptop ? "Dust in the fans or blocked vents is the usual cause." : "Dust on the card and the case's filters is the usual cause."}`,
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what to do", ask: `My graphics card is at ${r(gpuT)}°C. What should I do?` },
    });
  }

  // Windows' own background work, by name.
  const bgTop = byCpu.find((p) => backgroundOf(p) && (p.cpu >= SL_BACKGROUND_CPU || (disk != null && disk >= SL_DISK_BUSY && p.cpu >= 2)));
  if (bgTop) {
    const [, who, what] = backgroundOf(bgTop)!;
    const driveToo = disk != null && disk >= SL_DISK_BUSY;
    add({
      id: `background-${what}`, score: bgTop.cpu >= 20 || driveToo ? 72 : 62, noisy: true,
      title: `${who} ${BG_DOING[what]}`,
      evidence: `${bgTop.name} uses ${pctOf(bgTop.cpu)} of the processor${driveToo ? ` · drive ${pctOf(disk!)} busy` : ""}`,
      why: "This is Windows' own work. It usually finishes on its own, and the fans settle when it does.",
      step: { kind: "ask", label: "Ask about it", ask: `${who} ${BG_DOING[what]} on ${pc.name} (${bgTop.name}, ${pctOf(bgTop.cpu)} of the processor). Is that normal, and can I make it run at a better time?` },
    });
  }

  // The graphics card kept busy, usually by a game.
  if (gpuLoad != null && gpuLoad >= (loud ? SL_BUSY_LOUD : SL_BUSY)) {
    const top = byGpu[0] && (byGpu[0].gpu ?? 0) >= 20 ? byGpu[0] : undefined;
    const who = top ? nameOf(top) : null;
    // At its limit the temperature has a line of its own.
    const temp = gpuT != null && !(gpuLim != null && gpuT >= gpuLim - SL_AT_LIMIT) ? `${r(gpuT)}°C` : null;
    add({
      id: "gpu-busy", score: 70 + (loud ? 10 : 0), noisy: true,
      title: who ? `${who} keeps the graphics card at ${pctOf(gpuLoad)}` : `Graphics card is ${pctOf(gpuLoad)} busy`,
      evidence: [top && top.gpu != null && `${top.name} uses ${pctOf(top.gpu)} of it`, temp, loud && fastest && `fans at ${rpm(fastest.rpm)}`].filter(Boolean).join(" · "),
      why: loud ? "The harder the card works, the faster its fans spin to keep it cool. Lower settings or a frame rate cap make it work less." : undefined,
      step: { kind: "ask", label: "Ask about settings", ask: who ? `${who} keeps my graphics card at ${pctOf(gpuLoad)} and the fans get loud. Which settings would make it quieter without losing much?` : `My graphics card is ${pctOf(gpuLoad)} busy. What's using it?` },
    });
  }

  // The processor kept busy by an app that isn't Windows' own background work (that's named above).
  if (cpuLoad != null && cpuLoad >= (loud ? SL_BUSY_LOUD : SL_BUSY)) {
    const top = byCpu[0] && !backgroundOf(byCpu[0]) && byCpu[0].cpu >= 10 ? byCpu[0] : undefined;
    if (!(bgTop && byCpu[0] === bgTop)) {
      const who = top ? nameOf(top) : null;
      add({
        id: "cpu-busy", score: 68 + (loud ? 8 : 0), noisy: true,
        title: who ? `${who} keeps the processor at ${pctOf(cpuLoad)}` : `Processor is ${pctOf(cpuLoad)} busy`,
        evidence: [top && `${top.name} uses ${pctOf(top.cpu)} of it`, cpuT != null && `${r(cpuT)}°C`, loud && fastest && `fans at ${rpm(fastest.rpm)}`].filter(Boolean).join(" · "),
        step: { kind: "ask", label: "Ask about it", ask: who ? `${who} keeps my processor at ${pctOf(cpuLoad)}. Is that normal, and how do I calm it down?` : `My processor is ${pctOf(cpuLoad)} busy. What's using it?` },
      });
    }
  }

  // Memory nearly full: Windows moves things to the drive and apps wait.
  if (mem != null && mem >= SL_MEM_FULL) {
    const top = byMem[0];
    const found = issue("mem-full");
    add({
      id: "mem-full", score: 75, noisy: false,
      title: `Memory is ${pctOf(mem)} full`,
      evidence: top ? `${appName(top)} holds the most, ${gb(top.memMb)}` : "",
      why: "When memory runs out, Windows moves things to the drive, which is much slower. Closing apps or browser tabs you aren't using frees it.",
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what's using it", ask: "My memory is almost full. What's using it?" },
    });
  }

  // The drive busy all the time, when nothing named above explains it.
  if (disk != null && disk >= SL_DISK_BUSY && !bgTop) {
    add({
      id: "disk-busy", score: 60, noisy: false,
      title: `Drive is ${pctOf(disk)} busy`,
      evidence: "Opening apps and files waits on it",
      step: { kind: "go", label: "See the readings", route: "logs" },
    });
  }

  // Hotter than this PC usually runs, from the alerts.
  for (const a of pc.alerts ?? []) {
    if (a.kind !== "hotter-than-usual" && a.kind !== "too-hot" && a.kind !== "fan-stopped") continue;
    if (a.kind === "too-hot" && out.some((c) => c.id === `${a.part}-limit`)) continue;
    add({
      id: `alert-${a.id}`, score: a.kind === "fan-stopped" ? 90 : a.kind === "too-hot" ? 78 : 58, noisy: a.kind !== "fan-stopped",
      title: a.title, evidence: a.detail,
      step: a.ask ? { kind: "ask", label: "Ask what to do", ask: a.ask } : { kind: "go", label: "See the part", route: "pc", part: a.part },
    });
  }

  // Power saver holds the processor back.
  const plan = pc.settings?.powerPlans.find((p) => p.active);
  if (plan && /saver/i.test(plan.name)) {
    const balanced = pc.settings!.powerPlans.find((p) => /^balanced$/i.test(p.name.trim()));
    add({
      id: "power-saver", score: cpuLoad != null && cpuLoad >= 50 ? 66 : 45, noisy: false,
      title: "Power saver is holding the processor back",
      evidence: `Windows' power plan is ${plan.name}`,
      why: "It keeps the processor's speed down to save power. Balanced lets it speed up when there's work to do.",
      step: balanced ? { kind: "fix", label: "Review change", fix: [{ kind: "power.plan", guid: balanced.guid }], why: "Power saver keeps the processor's speed down." } : { kind: "ask", label: "Ask about it", ask: `${pc.name} uses the ${plan.name} power plan. Should I change it?` },
    });
  }

  // Unplugged, Windows holds a laptop's processor back to make the charge last: a cap on battery, or the power mode.
  const batt = pc.battery, settings = pc.settings;
  if (laptop && batt?.state === "discharging") {
    const at = batt.level != null ? ` at ${batt.level}%` : "";
    const busyNow = cpuLoad != null && cpuLoad >= 50;
    const cap = settings?.maxProcessorState, mode = settings?.powerMode;
    if (cap && cap.dc < SL_BATTERY_CAP) {
      add({
        id: "battery-power", score: busyNow ? 70 : 52, noisy: false,
        title: `On battery, the processor is capped at ${cap.dc}%`,
        evidence: `Unplugged${at} · ${cap.dc}% on battery, ${cap.ac}% plugged in`,
        why: `Windows' power plan holds the processor to ${cap.dc}% of its speed while the ${word} runs on battery. Lifting the cap makes it faster unplugged, and the charge runs down sooner.`,
        step: { kind: "fix", label: "Review change", fix: [{ kind: "power.maxProcessorState", ac: cap.ac, dc: 100 }], why: `On battery the processor is capped at ${cap.dc}%.` },
      });
    } else if (mode && (mode.saver || mode.dc === "efficiency") && !out.some((c) => c.id === "power-saver")) {
      const saver = saverName(pc.os);
      // Plugging in turns the saver off and switches to the plugged-in power mode, unless that one saves power too.
      const plugHelps = mode.saver || mode.ac !== "efficiency";
      add({
        id: "battery-power", score: busyNow ? 66 : 50, noisy: false,
        title: "On battery, Windows is saving power",
        evidence: `Unplugged${at} · ${mode.saver ? `${saver} is on` : "Power mode is Best power efficiency"}`,
        why: plugHelps
          ? `To make the charge last, Windows holds the processor back while the ${word} runs on battery. Plugging in brings back full speed.`
          : `To make the charge last, Windows holds the processor back. The power mode is Best power efficiency plugged in too.`,
        step: plugHelps ? { kind: "tip", label: "Plug in" } : { kind: "ask", label: "Ask about it", ask: `My ${word}'s power mode is Best power efficiency, even plugged in. Should I change it?` },
      });
    }
  }

  // A game on a laptop's built-in graphics: the graphics card sleeps while the slower chip does the work.
  const card = laptop && gpu?.chip ? gpu : undefined;
  const wrongChip = card && apps.filter((p) => (p.builtIn ?? 0) >= SL_BUILT_IN && (p.gpu ?? 0) < 5 && !backgroundOf(p) && !NOT_GAMES.test(p.name)).sort((a, b) => (b.builtIn ?? 0) - (a.builtIn ?? 0))[0];
  if (card && wrongChip) {
    const who = nameOf(wrongChip);
    const builtIn = chipShort(pc.graphics?.find((g) => g.integrated)?.name) ?? "built-in chip", fast = chipShort(card.chip) ?? "graphics card";
    const set = settings?.gpuPreferences?.[wrongChip.name.toLowerCase()] === "high";
    add({
      id: "built-in-graphics", score: 82, noisy: false,
      title: `${who} is running on the built-in graphics`,
      evidence: [`${wrongChip.name} uses ${pctOf(wrongChip.builtIn!)} of the ${builtIn}`, card.asleep ? `${fast} asleep` : card.load != null ? `${fast} ${pctOf(card.load)} busy` : null].filter(Boolean).join(" · "),
      why: set
        ? `This ${word} has two graphics chips. ${who} is already set to use the ${fast}, which takes effect the next time it starts.`
        : `This ${word} has two graphics chips. Windows ran ${who} on the built-in ${builtIn}, which saves power but is much slower than the ${fast}. Setting it to use the ${fast} takes effect the next time ${who} starts.`,
      step: set ? { kind: "tip", label: "Reopen it" } : { kind: "fix", label: "Review change", fix: [{ kind: "display.appGpu", app: wrongChip.name, gpu: "high" }], why: `Windows ran ${who} on the built-in graphics. It uses the ${fast} the next time it starts.` },
    });
  }

  // Fans fast with nothing busy or hot: dust or the fan settings, likely.
  // A game on the built-in graphics is busy too, though the graphics card reads nothing.
  const busyAny = (cpuLoad ?? 0) >= 50 || (gpuLoad ?? 0) >= 50 || !!wrongChip;
  if (loud && !busyAny && !out.some((c) => c.noisy)) {
    add({
      id: "fans-fast", score: 55, noisy: true, likely: true,
      title: "Fans are fast while nothing is busy",
      evidence: [upper(fanWords), cpuLoad != null && `processor ${pctOf(cpuLoad)} busy`, gpuLoad != null && `graphics card ${pctOf(gpuLoad)}`].filter(Boolean).join(" · "),
      why: "With nothing busy or hot, dust in the fans or the fan settings are the likely cause.",
      step: { kind: "go", label: "See the fans", route: "pc", part: "fans" },
    });
  }

  // Many apps start with Windows: a slow start, and more running in the background.
  // Only beside another cause of slowness: on its own it's no reason a PC is slow or loud right now.
  const startup = pc.settings?.startupOn ?? 0;
  if (startup >= SL_STARTUP && out.some((c) => !c.noisy)) {
    const found = issue("startup");
    add({
      id: "startup", score: 30, noisy: false,
      title: `${startup} apps start with Windows`,
      evidence: "Each one slows the start and keeps running in the background",
      step: found ? issueStep(found) : { kind: "ask", label: "Review startup apps", ask: "Which of my startup apps can I safely turn off?" },
    });
  }

  // Nothing now, but the last hour had a busy stretch: that's likely what was heard.
  if (!out.some((c) => c.score >= 50)) {
    const busy = recent.filter((p) => (p.gpuLoad ?? 0) >= SL_BUSY || (p.cpuLoad ?? 0) >= SL_BUSY);
    if (busy.length) {
      const g = Math.max(...busy.map((p) => p.gpuLoad ?? 0)), c = Math.max(...busy.map((p) => p.cpuLoad ?? 0));
      const game = busy.find((p) => p.game)?.game;
      const part = g >= c ? "graphics card" : "processor", at = r(Math.max(g, c));
      add({
        id: "earlier", score: 40, noisy: true, likely: true,
        title: `Earlier, ${game ? `${game} kept` : "something kept"} the ${part} at ${at}%`,
        evidence: "Quiet now",
        why: "That busy stretch in the last hour is likely what you heard.",
        step: { kind: "go", label: "See the readings", route: "logs" },
      });
    }
  }

  const causes = out.sort((a, b) => b.score - a.score).slice(0, 3);
  const top = causes[0];

  // What was checked, in a line each.
  const checked: string[] = [];
  if (cpu) checked.push(["Processor", [cpuLoad != null && `${pctOf(cpuLoad)} busy`, cpuT != null && `${r(cpuT)}°C`].filter(Boolean).join(", ") || "no reading"].join(": "));
  if (gpu) checked.push(["Graphics card", [gpuLoad != null && `${pctOf(gpuLoad)} busy`, gpuT != null && `${r(gpuT)}°C`].filter(Boolean).join(", ") || "no reading"].join(": "));
  if (mem != null) checked.push(`Memory: ${pctOf(mem)} full`);
  if (disk != null) checked.push(`Drive: ${pctOf(disk)} busy`);
  if (fastest) checked.push(`Fans: ${rpm(fastest.rpm)} at most`);
  if (startup) checked.push(`Startup: ${startup} ${startup === 1 ? "app starts" : "apps start"} with Windows`);
  if (processes) checked.push(bgTop ? `Apps: ${appName(bgTop)} working in the background` : apps.length ? `Apps: ${appName(byCpu[0])} is the busiest, at ${pctOf(byCpu[0].cpu)}` : "Apps: nothing busy");

  let headline: string;
  if (!top) headline = loud ? `Nothing looks wrong. ${upper(fanWords)} are normal for what ${pc.name} is doing.` : "Nothing looks wrong right now.";
  // The causes are the rows under it, each with its numbers and what to do, so the headline points at them, not repeats them.
  else if (loud && top.noisy) headline = top.likely ? "The fans are loud. Here's the likely reason." : "The fans are loud. Here's why.";
  else headline = `Here's what's ${top.likely ? "likely " : ""}slowing ${pc.name} down.`;

  return {
    headline, calm: !top, loud, causes: causes.map(({ score: _s, noisy: _n, ...c }) => c), checked,
    appsNote: processes === null ? `The list of apps needs the Rig app open on ${pc.name}.` : undefined,
    asOf: pc.online ? undefined : `From ${pc.name}'s last readings.`,
  };
}
