// The demo's Windows events, busiest apps and one finished recording: Atlas's
// graphics driver reset during a hot Cyberpunk evening, the way a real one
// reads in the event log and in the readings around it.

import type { ChatMessage } from "../client";
import { captureKinds, cleanEvents, intervalFor, limitsOf, sampleFrom, summarise, toInfo, toRequest, type ProcessUse, type RawEvent, type Recording, type RecordingRequest } from "../recordings";
import type { Inventory } from "../telemetry";
import { buildPC } from "../view";
import { activityAt, type Activity } from "./schedule";
import { simulate } from "./simulate";

const MIN = 60_000;
const DAY = 864e5;
const exe: Record<string, string> = { "Cyberpunk 2077": "Cyberpunk2077.exe", "Counter-Strike 2": "cs2.exe", "Baldur's Gate 3": "bg3.exe", "Stardew Valley": "Stardew Valley.exe", Minecraft: "javaw.exe" };

/** The busiest apps on a demo PC at a moment, following what it's doing. */
export function demoProcesses(inv: Inventory, t: number, act: Activity = activityAt(inv.machine.kind, t)): ProcessUse[] {
  const wob = (seed: number, amp: number) => Math.sin(t / 9000 + seed) * amp;
  const list: ProcessUse[] = [
    { name: "chrome.exe", cpu: 3 + wob(1, 1.5), memMb: 2100 + wob(2, 120) },
    { name: "Discord.exe", cpu: 1.2 + wob(3, 0.6), memMb: 520 },
    { name: "dwm.exe", cpu: 0.8 + wob(4, 0.3), memMb: 140, gpu: 2 },
  ];
  if (act.game) list.push({ name: exe[act.game] ?? `${act.game}.exe`, cpu: 6 + act.cpu * 48 + wob(5, 3), memMb: 6800 + act.gpu * 3400, gpu: Math.round(act.gpu * 94) });
  else if (act.cpu > 0.9) list.push({ name: "TiWorker.exe", cpu: 58 + wob(6, 6), memMb: 900 });
  else if (act.cpu > 0.2) list.push({ name: "EXCEL.EXE", cpu: 9 + wob(7, 3), memMb: 780 }, { name: "ms-teams.exe", cpu: 6 + wob(8, 2), memMb: 1300 });
  return list;
}

/** The start of the latest Wednesday evening that's fully behind us: the demo's hot Cyberpunk night. */
function hotEvening(now: number): number {
  const d = new Date(now);
  d.setHours(20, 10, 0, 0);
  while (d.getDay() !== 3 || d.getTime() + 60 * MIN > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

const RESET_AFTER = 31 * MIN + 24_000;

/** Atlas's event log for the last month: the driver reset the recording caught, an earlier one, and the usual odds and ends. */
export function demoEvents(kind: Inventory["machine"]["kind"], now: number, sinceMs = 0): RawEvent[] {
  if (kind !== "tower") return [];
  const at = (daysAgo: number, h: number, m: number) => { const d = new Date(now - daysAgo * DAY); d.setHours(h, m, 12, 0); return d.getTime(); };
  const reset = hotEvening(now) + RESET_AFTER;
  const list: RawEvent[] = [
    { t: reset, log: "System", source: "Display", id: 4101, level: "warning", message: "Display driver nvlddmkm stopped responding and has successfully recovered." },
    { t: reset - 7 * DAY + 14 * MIN, log: "System", source: "Display", id: 4101, level: "warning", message: "Display driver nvlddmkm stopped responding and has successfully recovered." },
    { t: at(2, 23, 12), log: "Application", source: "Application Error", id: 1000, level: "error", message: "Faulting application name: Discord.exe, version: 1.0.9171.0, faulting module name: discord_voice.node, exception code: 0xc0000005" },
    { t: at(9, 7, 55), log: "System", source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical", message: "The system has rebooted without cleanly shutting down first. This error could be caused if the system stopped responding, crashed, or lost power unexpectedly." },
    { t: at(12, 18, 3), log: "System", source: "Service Control Manager", id: 7031, level: "error", message: "The Steam Client Service service terminated unexpectedly. It has done this 1 time(s)." },
    { t: at(15, 21, 47), log: "System", source: "Microsoft-Windows-WHEA-Logger", id: 19, level: "warning", message: "A corrected hardware error has occurred. Reported by component: Processor Core. Error Source: Corrected Machine Check." },
    { t: at(21, 13, 20), log: "System", source: "disk", id: 153, level: "warning", message: "The IO operation at logical block address 0x1a2b3c for Disk 1 (PDO name: \\Device\\00000041) was retried." },
  ];
  return list.filter((e) => e.t >= sinceMs && e.t <= now).sort((a, b) => b.t - a.t);
}

export const DEMO_RECORDING_ID = "demo-reset";
const question = "My screen went black for a couple of seconds while I was playing Cyberpunk. What happened?";

/** The finished recording on Atlas: 45 minutes of Cyberpunk with the graphics card creeping up to its limit and one driver reset. */
export function demoRecording(inv: Inventory, now: number): Recording {
  const from = hotEvening(now), minutes = 45, intervalMs = intervalFor(minutes);
  const game: Activity = { cpu: 0.7, gpu: 1, game: "Cyberpunk 2077" };
  const samples = [];
  let cooled = 0;
  for (let t = from; t <= from + minutes * MIN; t += intervalMs) {
    const p = (t - from) / (minutes * MIN);
    const sinceReset = t - (from + RESET_AFTER);
    const down = sinceReset >= 0 && sinceReset < 20_000;
    const act = down ? { ...game, gpu: 0.02 } : game;
    const s = sampleFrom(simulate(inv, t, { activity: game, dust: -0.35 + Math.min(1, p * 1.5) * 0.97 }), captureKinds, demoProcesses(inv, t, act));
    if (down) { cooled = Math.min(2, cooled + 1); s.gpuLoad = 4; }
    else if (sinceReset >= 20_000) cooled = Math.max(0, cooled - 1);
    if (s.gpu != null) s.gpu -= cooled;
    samples.push(s);
  }
  // Real sensors drift; the simulator's ripple is too regular at this sampling rate, so even it out.
  for (const k of ["cpu", "gpu", "cpuLoad"] as const) {
    const raw = samples.map((s) => s[k]);
    samples.forEach((s, i) => {
      const near = raw.slice(Math.max(0, i - 3), i + 4).filter((v): v is number => v != null);
      if (s[k] != null && near.length) s[k] = Math.round(near.reduce((a, b) => a + b, 0) / near.length + Math.sin(i * 2.399) * 0.8);
    });
  }
  const req: RecordingRequest = {
    id: DEMO_RECORDING_ID, by: "rig", minutes, capture: captureKinds, question,
    reason: "Watch temperatures, load and Windows events while you play, to catch the black screen.",
    createdAt: new Date(from - 20_000).toISOString(),
  };
  const r: Recording = {
    ...req, pcId: inv.machine.id, state: "done", intervalMs, startedAt: from, endsAt: from + minutes * MIN, finishedAt: from + minutes * MIN,
    samples, events: cleanEvents(demoEvents("tower", now, from).filter((e) => e.t <= from + minutes * MIN)), sampleCount: 0, eventCount: 0,
  };
  r.headline = summarise(r, limitsOf(buildPC(inv, null, null))).headline;
  return { ...r, ...toInfo(r) };
}

/** The conversation that led to the demo recording, so the chat shows the whole flow. */
export function demoConversation(inv: Inventory, now: number): ChatMessage[] {
  const r = demoRecording(inv, now);
  const back = new Date(r.endsAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return [
    { id: "demo-q", from: "you", text: question },
    {
      id: "demo-a", from: "rig", recording: toRequest(r), sources: [{ label: `${inv.machine.hostname}'s readings`, kind: "Your PC" }],
      text: `A black screen that comes back on its own is usually the graphics driver restarting, but I can't tell from here: right now ${inv.machine.hostname} is idle and I only have its ten-minute temperature history.\n\nSo I've started recording. For the next 45 minutes I'll keep the temperatures, how hard each part works, the busiest apps and anything Windows logs. Nothing on the PC changes. Play as you normally would and check back at ${back}.`,
    },
  ];
}
