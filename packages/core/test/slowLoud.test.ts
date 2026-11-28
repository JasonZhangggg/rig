import { describe, expect, it } from "vitest";
import { CloudClient, LocalClient, MemoryStore, appName, buildPC, cpuLimit, slowOrLoud, type HistoryPoint, type ProcessUse, type Snapshot, type SystemFacts } from "../src";
import { DemoClient, SimulatedLink, demoProcesses, fixtures, simulate, type Activity } from "../src/demo";
import { afterEach, vi } from "vitest";

// A Friday afternoon, so nothing in the fixtures depends on the clock.
const AT = Date.UTC(2026, 10, 20, 15, 0);
const REST: Activity = { cpu: 0.05, gpu: 0.03, game: null };
const GAME: Activity = { cpu: 0.7, gpu: 1, game: "Cyberpunk 2077" };

type Name = "atlas" | "pebble";
function pcOf(name: Name, act: Activity, tweak?: (s: Snapshot) => void, facts?: (f: SystemFacts) => void) {
  const { inv, facts: f0 } = fixtures[name];
  const snap = simulate(inv, AT, { activity: act });
  tweak?.(snap);
  const f = structuredClone(f0);
  facts?.(f);
  const { findings: _f, ...pc } = buildPC(inv, snap, f);
  return pc;
}
const setSensor = (s: Snapshot, hw: string, type: string, name: RegExp, value: number) => {
  for (const x of s.sensors) if (x.hw === hw && x.type === type && name.test(x.name)) x.value = value;
};
const apps = (name: Name, act: Activity) => demoProcesses(fixtures[name].inv, AT, act);

describe("why is my PC slow or loud", () => {
  it("says plainly when nothing looks wrong, and what it checked", () => {
    const a = slowOrLoud({ pc: pcOf("atlas", REST), processes: apps("atlas", REST), now: AT });
    expect(a.calm).toBe(true);
    expect(a.causes).toEqual([]);
    expect(a.headline).toBe("Nothing looks wrong right now.");
    expect(a.checked.join("\n")).toMatch(/^Processor: \d+% busy, \d+°C$/m);
    expect(a.checked.join("\n")).toMatch(/^Graphics card: \d+% busy, \d+°C$/m);
    expect(a.checked).toContain("Startup: 8 apps start with Windows");
    expect(a.checked.join("\n")).toMatch(/^Apps: Chrome is the busiest, at \d+%$/m);
    expect(a.appsNote).toBeUndefined();
  });

  it("names the game keeping the graphics card busy when the fans are loud", () => {
    const a = slowOrLoud({ pc: pcOf("atlas", GAME), processes: apps("atlas", GAME), now: AT });
    expect(a.loud).toBe(true);
    expect(a.headline).toBe("Fans are loud because Cyberpunk 2077 is keeping the graphics card at 97%.");
    const top = a.causes[0];
    expect(top.title).toBe("Cyberpunk 2077 keeps the graphics card at 97%");
    expect(top.evidence).toMatch(/^Cyberpunk2077\.exe uses 94% of it · \d+°C · fans at [\d,]+ rpm$/);
    expect(top.likely).toBeFalsy();
    expect(top.step).toMatchObject({ kind: "ask", label: "Ask about settings" });
    if (top.step.kind === "ask") expect(top.step.ask).toMatch(/^Cyberpunk 2077 keeps my graphics card at 97%/);
  });

  it("takes the game's own name from the last hour of history", () => {
    const history: HistoryPoint[] = [{ t: AT - 15 * 60_000, cpu: 70, gpu: 78, busy: true, game: "Cyberpunk 2077", gpuLoad: 95 }];
    const procs: ProcessUse[] = [{ name: "Cyberpunk2077_x64.exe", cpu: 40, memMb: 8000, gpu: 92 }];
    const a = slowOrLoud({ pc: pcOf("atlas", GAME), processes: procs, history, now: AT });
    expect(a.causes[0].title).toBe("Cyberpunk 2077 keeps the graphics card at 97%");
    // A different game earlier in the hour doesn't rename the one running now.
    const other = slowOrLoud({ pc: pcOf("atlas", GAME), processes: [{ name: "Tetris.exe", cpu: 40, memMb: 800, gpu: 92 }], history, now: AT });
    expect(other.causes[0].title).toBe("Tetris keeps the graphics card at 97%");
  });

  it("points at the cooler when the processor is hot at rest", () => {
    const hot = cpuLimit(fixtures.atlas.inv.cpu.name) + 1;
    const pc = pcOf("atlas", REST, (s) => { setSensor(s, "cpu", "temperature", /tctl|tdie/i, hot); setSensor(s, "cpu", "load", /^cpu total$/i, 8); });
    const a = slowOrLoud({ pc, processes: apps("atlas", REST), now: AT });
    const top = a.causes[0];
    expect(top.id).toBe("cpu-hot-rest");
    expect(top.likely).toBe(true);
    expect(top.title).toBe("Processor is hot while barely working");
    expect(top.evidence).toBe(`${hot}°C at 8% busy · limit ${hot - 1}°C`);
    expect(top.why).toMatch(/points at the cooler/);
    // The health check's own finding is the next step.
    expect(top.step).toMatchObject({ kind: "issue", label: "Ask what to do", issue: { id: "cpu-hot" } });
    expect(a.headline).toBe("Likely: the processor is hot while barely working, which points at the cooler.");
  });

  it("says memory is nearly full and which app holds the most", () => {
    const pc = pcOf("atlas", REST, (s) => setSensor(s, "memory", "load", /^memory$/i, 95));
    const procs: ProcessUse[] = [{ name: "chrome.exe", cpu: 4, memMb: 9830 }, { name: "Discord.exe", cpu: 1, memMb: 600 }];
    const a = slowOrLoud({ pc, processes: procs, now: AT });
    expect(a.headline).toBe("Memory is 95% full, so apps wait on the drive.");
    expect(a.causes[0].evidence).toBe("Chrome holds the most, 9.6 GB");
    expect(a.causes[0].step).toMatchObject({ kind: "issue", label: "Ask what's using it", issue: { id: "mem-full" } });
    // With a cause of slowness, the startup apps come along as a smaller one.
    expect(a.causes.map((c) => c.id)).toContain("startup");
  });

  it("names a background scan by its process, with the drive it keeps busy", () => {
    const pc = pcOf("atlas", REST, (s) => { setSensor(s, "cpu", "load", /^cpu total$/i, 31); setSensor(s, "storage", "load", /total activity/i, 92); });
    const procs: ProcessUse[] = [{ name: "MsMpEng.exe", cpu: 22.4, memMb: 410 }, { name: "chrome.exe", cpu: 3, memMb: 2100 }];
    const a = slowOrLoud({ pc, processes: procs, now: AT });
    const top = a.causes[0];
    expect(top.title).toBe("Windows Security is scanning in the background");
    expect(top.evidence).toBe("MsMpEng.exe uses 22% of the processor · drive 92% busy");
    expect(top.step).toMatchObject({ kind: "ask", label: "Ask about it" });
    // The busy drive is the scan's doing, not a second cause.
    expect(a.causes.map((c) => c.id)).not.toContain("disk-busy");
  });

  it("names Windows Update keeping a laptop busy, and doesn't blame it twice", () => {
    const busy: Activity = { cpu: 1, gpu: 0.05, game: null };
    const a = slowOrLoud({ pc: pcOf("pebble", busy), processes: apps("pebble", busy), now: AT });
    expect(a.causes[0].title).toBe("Windows Update is installing updates in the background");
    expect(a.headline).toBe("Fans are loud because Windows Update is installing updates in the background.");
    expect(a.causes.map((c) => c.id)).not.toContain("cpu-busy");
  });

  it("offers to switch off Power saver through the usual review", () => {
    const pc = pcOf("atlas", REST, undefined, (f) => { for (const p of f.powerPlans) p.active = p.name === "Power saver"; });
    const a = slowOrLoud({ pc, processes: [], now: AT });
    const c = a.causes.find((x) => x.id === "power-saver")!;
    expect(c.title).toBe("Power saver is holding the processor back");
    expect(c.step).toEqual({ kind: "fix", label: "Review change", fix: [{ kind: "power.plan", guid: "381b4222-f694-41f0-9685-ff5bb260df2e" }], why: "Power saver keeps the processor's speed down." });
  });

  it("marks fans that run fast with nothing busy as likely dust or settings", () => {
    const pc = pcOf("atlas", REST, (s) => setSensor(s, "board", "fan", /fan #/i, 2200));
    const a = slowOrLoud({ pc, processes: [], now: AT });
    expect(a.causes[0]).toMatchObject({ id: "fans-fast", likely: true, step: { kind: "go", route: "pc", part: "fans" } });
    expect(a.headline).toBe("Fans are loud, likely because of dust or the fan settings, since nothing is busy.");
  });

  it("looks back over the last hour when it's quiet now", () => {
    const history: HistoryPoint[] = [
      { t: AT - 25 * 60_000, cpu: 60, gpu: 76, busy: true, game: "Baldur's Gate 3", gpuLoad: 93, cpuLoad: 40 },
      { t: AT - 3 * 3600_000, cpu: 60, gpu: 76, busy: true, game: "Counter-Strike 2", gpuLoad: 99 },
    ];
    const a = slowOrLoud({ pc: pcOf("atlas", REST), processes: [], history, now: AT });
    expect(a.causes[0]).toMatchObject({ id: "earlier", title: "Earlier, Baldur's Gate 3 kept the graphics card at 93%", likely: true });
  });

  it("still answers on the website, from the last synced readings, and says what needs the app", () => {
    const pc = { ...pcOf("atlas", GAME), online: false };
    const a = slowOrLoud({ pc, processes: null, now: AT });
    expect(a.causes[0].title).toBe("Graphics card is 97% busy");
    expect(a.appsNote).toBe("The list of apps needs the Rig app open on Atlas.");
    expect(a.asOf).toBe("From Atlas's last readings.");
    expect(a.checked.some((l) => l.startsWith("Apps:"))).toBe(false);
  });

  it("never gives more than three causes", () => {
    const pc = pcOf("atlas", GAME, (s) => { setSensor(s, "memory", "load", /^memory$/i, 96); setSensor(s, "storage", "load", /total activity/i, 95); setSensor(s, "cpu", "load", /^cpu total$/i, 92); }, (f) => { for (const p of f.powerPlans) p.active = p.name === "Power saver"; });
    expect(slowOrLoud({ pc, processes: apps("atlas", GAME), now: AT }).causes).toHaveLength(3);
  });

  it("with the fans loud, blames the game over a small background scan", () => {
    const play: Activity = { cpu: 0.5, gpu: 0.75, game: "Baldur's Gate 3" };
    const procs = [...apps("atlas", play), { name: "MsMpEng.exe", cpu: 9.6, memMb: 380 }];
    const a = slowOrLoud({ pc: pcOf("atlas", play, (s) => setSensor(s, "gpu", "fan", /gpu fan/i, 2300)), processes: procs, now: AT });
    expect(a.headline).toBe("Fans are loud because Baldur's Gate 3 is keeping the graphics card at 74%.");
    expect(a.causes.map((c) => c.id)).toEqual(["gpu-busy", "background-scan"]);
  });

  it("calls apps by the names people know", () => {
    expect(appName({ name: "SearchIndexer.exe" })).toBe("Windows Search");
    expect(appName({ name: "TiWorker.exe" })).toBe("Windows Update");
    expect(appName({ name: "Cyberpunk2077.exe" })).toBe("Cyberpunk 2077");
    expect(appName({ name: "bg3.exe" })).toBe("Baldur's Gate 3");
    expect(appName({ name: "SomeTool.exe" })).toBe("SomeTool");
  });
});

describe("reading the busiest apps", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reads them on this PC through the helper, and not for another PC", async () => {
    const t = new Date("2026-11-17T20:00:00").getTime();
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
    const client = new LocalClient(sim, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => t });
    const list = await client.processes(fixtures.atlas.inv.machine.id);
    // Tuesday evening is Counter-Strike on the demo desktop.
    expect(list?.map((p) => p.name)).toContain("cs2.exe");
    expect(await client.processes("some-other-pc")).toBeNull();
    client.stop();
  });

  it("says the website can't read them", async () => {
    expect(await new CloudClient({ base: "/api" }).processes("pc-1")).toBeNull();
  });

  it("gives the demo desktop a game and a background scan to find, whenever it's checked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // A Tuesday at 11 AM, when the demo desktop is only doing office work.
    vi.setSystemTime(new Date(2026, 10, 17, 11, 0));
    const demo = new DemoClient();
    const procs = await demo.processes("demo-atlas");
    const pc = (await demo.machines()).find((p) => p.id === "demo-atlas")!;
    const a = slowOrLoud({ pc, processes: procs, now: Date.now() });
    // The demo desktop is dusty, so its card also reaches its limit.
    expect(a.headline).toBe("Fans are loud because Cyberpunk 2077 is keeping the graphics card at 97%, and it's at its 88°C limit.");
    expect(a.causes.map((c) => c.title)).toEqual(["Cyberpunk 2077 keeps the graphics card at 97%", "Graphics card is at its 88°C limit", "Windows Security is scanning in the background"]);
    // Home shows the same game.
    expect(pc.parts?.gpu?.load).toBe(97);
  });
});
