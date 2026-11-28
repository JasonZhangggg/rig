// "Why is my PC slow or loud?", answered on the spot from Rig's own readings: how hard each part works and how warm
// it is, the fans, memory, the drive, the busiest apps and the last hour of history. No chat round trip, so it can only
// say what the numbers show; where a cause is a reading of the signs rather than a reading itself, it's marked likely.
// Pure, so the desktop, the website and the demo give the same answer from the same readings.

import type { ActionCall } from "./actions";
import type { HistoryPoint, Issue, PC, Route } from "./model";
import type { ProcessUse } from "./recordings";

/** What to do about a cause: an existing finding (its fix or its own action), a change to review, a place in Rig, or a question for the chat. */
export type SlowLoudStep =
  | { kind: "issue"; label: string; issue: Issue }
  | { kind: "fix"; label: string; fix: ActionCall[]; why: string }
  | { kind: "go"; label: string; route: Route; part?: string }
  | { kind: "ask"; label: string; ask: string };

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
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rpm = (n: number) => `${r(n).toLocaleString("en-US")} rpm`;
const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
const pctOf = (n: number) => `${r(n)}%`;

interface Candidate extends SlowLoudCause {
  score: number;
  /** The cause as the end of "Fans are loud because …". */
  because: string;
  /** It makes noise: heat or a part kept busy. Memory or a capped processor doesn't. */
  noisy: boolean;
}

export function slowOrLoud({ pc, history = [], processes, now = Date.now() }: SlowLoudInput): SlowLoudAnswer {
  const parts = pc.parts ?? {};
  const cpu = parts.cpu, gpu = parts.gpu, ram = parts.ram;
  const laptop = pc.kind === "laptop";
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
      title: "Processor is hot while barely working", because: "the processor is hot while barely working, which points at the cooler",
      evidence: `${r(cpuT)}°C at ${pctOf(cpuLoad)} busy · limit ${cpuLim}°C`,
      why: "A processor at rest should run well under its limit. That points at the cooler: a fan or pump that stopped, a cooler that came loose, or dried-out paste.",
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what to do", ask: `My processor is at ${r(cpuT)}°C while only ${pctOf(cpuLoad)} busy. Is the cooler failing?` },
    });
  } else if (hotIdle) {
    add({ id: "cpu-hot-rest", score: 85, noisy: true, likely: true, title: hotIdle.title, because: lower(hotIdle.title), evidence: hotIdle.evidence?.[0] ?? hotIdle.body, why: hotIdle.body, step: issueStep(hotIdle) });
  }

  // A part at its limit slows itself down to stay safe, and its fans run flat out.
  if (cpuT != null && cpuLim != null && cpuT >= cpuLim - SL_AT_LIMIT && (cpuLoad == null || cpuLoad > SL_REST)) {
    const found = issue("cpu-hot");
    add({
      id: "cpu-limit", score: 78, noisy: true,
      title: `Processor is at its ${cpuLim}°C limit`, because: `the processor is at its ${cpuLim}°C limit and slowing itself down`,
      evidence: `${r(cpuT)}°C${cpuLoad != null ? ` at ${pctOf(cpuLoad)} busy` : ""}`,
      why: "At its limit it gives up some speed to stay safe, and its fan runs flat out.",
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what to do", ask: `My processor is at ${r(cpuT)}°C. What should I do?` },
    });
  }
  if (gpuT != null && gpuLim != null && gpuT >= gpuLim - SL_AT_LIMIT) {
    const found = issue("gpu-hot", "gpu-hotspot-hot");
    add({
      id: "gpu-limit", score: 78, noisy: true,
      title: `Graphics card is at its ${gpuLim}°C limit`, because: `the graphics card is at its ${gpuLim}°C limit and slowing itself down`,
      evidence: `${r(gpuT)}°C${gpuLoad != null ? ` at ${pctOf(gpuLoad)} busy` : ""}`,
      why: "At its limit it gives up some speed to stay safe, and its fans run flat out. Dust on the card and the case's filters is the usual cause.",
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
      title: `${who} ${BG_DOING[what]}`, because: `${who} ${BG_DOING[what]}`,
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
      because: who ? `${who} is keeping the graphics card at ${pctOf(gpuLoad)}` : `the graphics card is ${pctOf(gpuLoad)} busy`,
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
        because: who ? `${who} is keeping the processor at ${pctOf(cpuLoad)}` : `the processor is ${pctOf(cpuLoad)} busy`,
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
      title: `Memory is ${pctOf(mem)} full`, because: `memory is ${pctOf(mem)} full, so apps wait on the drive`,
      evidence: top ? `${appName(top)} holds the most, ${gb(top.memMb)}` : "",
      why: "When memory runs out, Windows moves things to the drive, which is much slower. Closing apps or browser tabs you aren't using frees it.",
      step: found ? issueStep(found) : { kind: "ask", label: "Ask what's using it", ask: "My memory is almost full. What's using it?" },
    });
  }

  // The drive busy all the time, when nothing named above explains it.
  if (disk != null && disk >= SL_DISK_BUSY && !bgTop) {
    add({
      id: "disk-busy", score: 60, noisy: false,
      title: `Drive is ${pctOf(disk)} busy`, because: `the drive is ${pctOf(disk)} busy, so everything waits on it`,
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
      title: a.title, because: lower(a.title), evidence: a.detail,
      step: a.ask ? { kind: "ask", label: "Ask what to do", ask: a.ask } : { kind: "go", label: "See the part", route: "pc", part: a.part },
    });
  }

  // Power saver holds the processor back.
  const plan = pc.settings?.powerPlans.find((p) => p.active);
  if (plan && /saver/i.test(plan.name)) {
    const balanced = pc.settings!.powerPlans.find((p) => /^balanced$/i.test(p.name.trim()));
    add({
      id: "power-saver", score: cpuLoad != null && cpuLoad >= 50 ? 66 : 45, noisy: false,
      title: "Power saver is holding the processor back", because: "the Power saver plan is holding the processor back",
      evidence: `Windows' power plan is ${plan.name}`,
      why: "It keeps the processor's speed down to save power. Balanced lets it speed up when there's work to do.",
      step: balanced ? { kind: "fix", label: "Review change", fix: [{ kind: "power.plan", guid: balanced.guid }], why: "Power saver keeps the processor's speed down." } : { kind: "ask", label: "Ask about it", ask: `${pc.name} uses the ${plan.name} power plan. Should I change it?` },
    });
  }

  // Fans fast with nothing busy or hot: dust or the fan settings, likely.
  const busyAny = (cpuLoad ?? 0) >= 50 || (gpuLoad ?? 0) >= 50;
  if (loud && !busyAny && !out.some((c) => c.noisy)) {
    add({
      id: "fans-fast", score: 55, noisy: true, likely: true,
      title: "Fans are fast while nothing is busy", because: "of dust or the fan settings, since nothing is busy",
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
      title: `${startup} apps start with Windows`, because: `${startup} apps start with Windows and keep running`,
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
        title: `Earlier, ${game ? `${game} kept` : "something kept"} the ${part} at ${at}%`, because: `${game ?? "something"} kept the ${part} at ${at}% in the last hour`,
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
  else if (loud && top.noisy) {
    // The part a game keeps busy is often also the one at its limit: say both in one go.
    const hot = causes.find((c) => c.id === (top.id === "gpu-busy" ? "gpu-limit" : top.id === "cpu-busy" ? "cpu-limit" : ""));
    const lim = top.id === "gpu-busy" ? gpuLim : cpuLim;
    headline = `Fans are loud${top.likely ? ", likely" : ""} because ${top.because}${hot ? `, and it's at its ${lim}°C limit` : ""}.`;
  }
  else headline = `${top.likely ? "Likely: " : ""}${top.likely ? top.because : upper(top.because)}.`;

  return {
    headline, calm: !top, loud, causes: causes.map(({ score: _s, because: _b, noisy: _n, ...c }) => c), checked,
    appsNote: processes === null ? `The list of apps needs the Rig app open on ${pc.name}.` : undefined,
    asOf: pc.online ? undefined : `From ${pc.name}'s last readings.`,
  };
}
