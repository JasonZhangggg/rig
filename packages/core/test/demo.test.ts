import { afterEach, describe, expect, it, vi } from "vitest";
import { fanTrend, insightContext, weekEvenings, weekTemps, type HistoryPoint, type PC, type WeekEvenings } from "../src";
import { DemoClient } from "../src/demo";

afterEach(() => { vi.useRealTimers(); });

/** The demo on Tuesday 17 November 2026 at 9 PM, local time, with each PC's last week. */
async function demoWeek(id: string): Promise<{ pc: PC; points: HistoryPoint[] }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 21, 0));
  const demo = new DemoClient();
  const pc = (await demo.machines()).find((p) => p.id === id)!;
  return { pc, points: await demo.history(id, "7d") };
}

const sessions = (e: WeekEvenings) => e.days.map((d) => d.sessions.map((s) => [s.game, s.kind, s.start, s.hours]));

describe("demo history", () => {
  it("gives the desktop a week of evening games, one hot evening and an update in the background", async () => {
    const { pc, points } = await demoWeek("demo-atlas");
    const ctx = insightContext(pc);
    expect(sessions(weekEvenings(points, ctx))).toEqual([
      [["Cyberpunk 2077", "hot", 0.5, 4]],
      [["Baldur's Gate 3", "played", 2, 3]],
      [["Baldur's Gate 3", "played", 1, 4.5]],
      [["Baldur's Gate 3", "played", 3, 4.5]],
      [["Counter-Strike 2", "played", 1.5, 2.5]],
      [[null, "background", 2, 1]],
      [["Counter-Strike 2", "played", 1, 2]],
    ]);

    const temps = weekTemps(points, ctx);
    expect(temps.subject).toBe("gpu");
    expect(temps.days.every((d) => d.idle != null && d.typical != null && d.peak != null)).toBe(true);
    expect(temps.peak).toBe(temps.days[0].peak);
  });

  it("gives the laptop processor-only history with exports and light games", async () => {
    const { pc, points } = await demoWeek("demo-pebble");
    const ctx = insightContext(pc);
    expect(points.every((p) => p.gpu === null)).toBe(true);
    expect(sessions(weekEvenings(points, ctx))).toEqual([
      [[null, "background", 3, 1]],
      [["Stardew Valley", "played", 0, 2.5]],
      // Its Core Ultra 7 155H runs to 110°C, so exports in the low 90s aren't hot for it.
      [[null, "background", 2, 2]],
      [["Minecraft", "played", 1.5, 3.5]],
      [["Stardew Valley", "played", 1, 2]],
      [["Minecraft", "played", 2, 1.5]],
      [[null, "background", 1.5, 1.5]],
    ]);
    expect(weekTemps(points, ctx).subject).toBe("cpu");
  });

  it("spins the fans up in the evenings", async () => {
    const { pc, points } = await demoWeek("demo-atlas");
    const { columns } = fanTrend(points, insightContext(pc));
    expect(columns.every((c) => c.rpm != null)).toBe(true);
    const at = (hour: number) => columns.filter((c) => new Date(c.from).getHours() === hour);
    expect(at(6).every((c) => c.level! < 0.5)).toBe(true);
    expect(Math.max(...at(18).map((c) => c.level!))).toBe(1);
  });
});

describe("demo alerts", () => {
  it("shows the desktop's graphics card running hotter than it used to, and nothing on the laptop", async () => {
    const { pc } = await demoWeek("demo-atlas");
    expect(pc.alerts).toEqual([expect.objectContaining({ id: "hotter-than-usual:gpu", severity: "warn", title: "Graphics card runs hotter than it used to" })]);
    expect(pc.alerts![0].detail).toMatch(/^In .+ it's been at \d+°C lately, up from its usual \d+°C\./);
    expect(new Date(pc.alerts![0].since).getTime()).toBeLessThan(Date.now() - 864e5);
    expect(pc.health).toBeGreaterThanOrEqual(75);
    expect(pc.summary).toBe("Running well. One thing needs a look.");
    const { pc: laptop } = await demoWeek("demo-pebble");
    expect(laptop.alerts).toBeUndefined();
  });
});

describe("the demo's approval cards", () => {
  it("has one of each: a registry command, an admin firewall rule, an uninstall and a refusal", async () => {
    const { demoCards, demoPreview } = await import("../src/demo");
    const seen = Object.fromEntries(demoCards.map((c) => { const p = demoPreview(c); return [c.key, p.outcome === "ready" ? `tier ${p.verdict.tier}${p.verdict.admin ? " admin" : ""}` : p.verdict.why]; }));
    expect(seen).toEqual({ registry: "tier 2", firewall: "tier 2 admin", uninstall: "tier 3", refused: "never", rollback: "tier 3" });
  });

  it("brings each card up from its question, and a nonce works once", async () => {
    const { demoCards, demoPreview } = await import("../src/demo");
    const demo = new DemoClient();
    for (const c of demoCards) {
      const events: string[] = [];
      await demo.chat("demo-atlas", [{ id: "q", from: "you", text: c.ask }], (e) => { if (e.type === "proposal") events.push(e.proposal.title); });
      expect(events).toEqual([c.title]);
    }
    const meta = { by: "rig" as const };
    const registry = demoCards.find((c) => c.key === "registry")!;
    const read = await demo.previewStep("demo-atlas", { kind: "command", cmd: registry.cmd });
    expect(read).toEqual({ ...demoPreview(registry), nonce: expect.stringMatching(/^demo-registry-/), expiresAt: expect.any(String) });
    const nonce = read.outcome === "ready" ? read.nonce : "";
    expect((await demo.applyStep("demo-atlas", nonce, meta)).outcome).toBe("applied");
    expect((await demo.applyStep("demo-atlas", nonce, meta)).outcome).toBe("expired");
    expect((await demo.changes("demo-atlas"))[0].title).toBe("Show seconds on the taskbar clock");
    expect((await demo.undoStep("demo-atlas", "undo-registry")).outcome).toBe("undone");
    expect((await demo.changes("demo-atlas"))[0].status).toBe("undone");
  });

  it("won't take a rolled-back card's nonce twice", async () => {
    const { demoCards } = await import("../src/demo");
    const demo = new DemoClient();
    const rollback = demoCards.find((c) => c.key === "rollback")!;
    const read = await demo.previewStep("demo-atlas", { kind: "command", cmd: rollback.cmd });
    const nonce = read.outcome === "ready" ? read.nonce : "";
    expect((await demo.applyStep("demo-atlas", nonce, { by: "rig" })).outcome).toBe("rolledBack");
    expect((await demo.applyStep("demo-atlas", nonce, { by: "rig" })).outcome).toBe("expired");
  });

  it("shows a firewall undo that something else got to first, and puts it back anyway when asked", async () => {
    const { demoCards } = await import("../src/demo");
    const demo = new DemoClient();
    const firewall = demoCards.find((c) => c.key === "firewall")!;
    const read = await demo.previewStep("demo-atlas", { kind: "command", cmd: firewall.cmd });
    await demo.applyStep("demo-atlas", read.outcome === "ready" ? read.nonce : "", { by: "rig" });
    expect(await demo.undoStep("demo-atlas", "undo-firewall")).toEqual({ outcome: "drifted", changed: ["The firewall rule Minecraft server"] });
    expect((await demo.changes("demo-atlas"))[0].status).toBe("applied");
    expect((await demo.undoStep("demo-atlas", "undo-firewall", true)).outcome).toBe("undone");
    expect((await demo.changes("demo-atlas"))[0].status).toBe("undone");
  });

  it("refuses a tier 3 card when the chat read outside text", async () => {
    const { demoCards } = await import("../src/demo");
    const demo = new DemoClient();
    const uninstall = demoCards.find((c) => c.key === "uninstall")!;
    const read = await demo.previewStep("demo-atlas", { kind: "command", cmd: uninstall.cmd }, true);
    expect(read.outcome === "refused" && read.verdict.why).toBe("tainted");
    expect((await demo.previewStep("demo-atlas", { kind: "command", cmd: uninstall.cmd }, false)).outcome).toBe("ready");
  });
});
