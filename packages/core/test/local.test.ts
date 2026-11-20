import { describe, expect, it, vi } from "vitest";
import { LocalClient, MemoryStore, type ActionCall, type ChatEvent, type HelperLink, type MachineSync, type Snapshot } from "../src";
import { SimulatedLink, fixtures } from "../src/demo";
import type { CloudClient } from "../src/cloud";

function setup(over: Partial<HelperLink> = {}, cloud: CloudClient | null = null) {
  let t = new Date("2026-11-17T20:00:00").getTime();
  const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
  const link: HelperLink = {
    hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), ...over,
  };
  const store = new MemoryStore();
  const client = new LocalClient(link, store, cloud, { tickMs: 1e9, syncEveryMs: 1e9, now: () => t });
  return { client, store, sim, advance: (ms: number) => { t += ms; } };
}

describe("LocalClient", () => {
  it("shows this PC with its own id", async () => {
    const { client } = setup();
    const [pc] = await client.machines();
    client.stop();
    expect(pc.id).toBe(fixtures.atlas.inv.machine.id);
    expect(pc.parts?.cpu.temp).toBeGreaterThan(20);
  });

  it("reads Windows' event log into the PC's findings", async () => {
    const at = new Date("2026-11-17T20:00:00").getTime();
    const off = (daysAgo: number) => ({ t: at - daysAgo * 864e5, log: "System" as const, source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical" as const, message: "The system has rebooted without cleanly shutting down first." });
    const { client } = setup({ events: async () => [off(1), off(4)] });
    await client.events(fixtures.atlas.inv.machine.id);
    const [pc] = await client.machines();
    client.stop();
    expect(pc.issues?.find((i) => i.id === "shutdowns")?.title).toBe("The PC turned off without shutting down twice");
    expect(pc.breakdown?.map((b) => b.label)).toContain("Crashes and errors");
  });

  it("shows the PC when its settings can't be read", async () => {
    const { client } = setup({ facts: () => Promise.reject(new Error("Settings are slow.")) });
    const [pc] = await client.machines();
    client.stop();
    expect(pc.parts?.cpu.temp).toBeGreaterThan(20);
  });

  it("says which step the first read is waiting on", async () => {
    let answer = () => {};
    const { client, sim } = setup({ inventory: () => new Promise((r) => { answer = () => r(sim.inventory()); }) });
    const pcs = client.machines();
    await vi.waitFor(() => expect(client.loadingStep()).toBe("reading this PC's parts"));
    answer();
    await pcs;
    client.stop();
    expect(client.loadingStep()).toBeNull();
  });

  it("logs each step of the first read, and the one that failed", async () => {
    const lines: string[] = [];
    let t = 0;
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
    const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => Promise.reject(new Error("Settings are slow.")), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c) };
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, now: () => (t += 1000), log: (level, msg) => lines.push(`${level} ${msg}`) });
    await client.start();
    client.stop();
    expect(lines.some((l) => /^info start: reading this PC's parts took \d+ ms$/.test(l))).toBe(true);
    expect(lines).toContain("error start: reading this PC's settings failed after 0 ms: Settings are slow.");
    expect(lines.at(-1)).toMatch(/^info start: done in \d+ ms$/);
  });

  it("shows this PC when it's opened by its saved id before its parts are read", async () => {
    let answer = () => {};
    const cloud = { signedIn: async () => false, watch: vi.fn(() => () => {}), watchRecordings: vi.fn(() => () => {}), changes: vi.fn(async () => []) } as unknown as CloudClient;
    const { client, sim } = setup({ inventory: () => new Promise((r) => { answer = () => r(sim.inventory()); }) }, cloud);
    const id = fixtures.atlas.inv.machine.id;
    const seen: string[] = [];
    const stop = client.watch(id, (pc) => seen.push(pc.id));
    const stopRecordings = client.watchRecordings(id, () => {});
    const changes = client.changes(id);
    await vi.waitFor(() => expect(client.loadingStep()).toBe("reading this PC's parts"));
    answer();
    await vi.waitFor(() => expect(seen).toContain(id));
    await changes;
    stop(); stopRecordings(); client.stop();
    expect(cloud.watch).not.toHaveBeenCalled();
    expect(cloud.watchRecordings).not.toHaveBeenCalled();
    expect(cloud.changes).not.toHaveBeenCalled();
  });

  it("tries again after a start that failed", async () => {
    let fail = true;
    const { client, sim } = setup({ inventory: () => (fail ? Promise.reject(new Error("Rig's helper didn't answer in time.")) : sim.inventory()) });
    await expect(client.machines()).rejects.toThrow("didn't answer in time");
    fail = false;
    const [pc] = await client.machines();
    client.stop();
    expect(pc.id).toBe(fixtures.atlas.inv.machine.id);
  });

  it("previews, applies, undoes and redoes a change", async () => {
    const { client, sim } = setup();
    await client.start();
    const id = client.id;
    const call: ActionCall = { kind: "windows.gameMode", enabled: !(await sim.facts()).gameMode };
    const rows = await client.preview(id, [call]);
    expect(rows[0][0]).toMatch(/game mode/i);

    const change = await client.apply(id, [call], { by: "you" });
    expect((await sim.facts()).gameMode).toBe(call.enabled);
    expect((await client.changes(id))[0].id).toBe(change.id);

    expect((await client.undo(id, change.id)).status).toBe("undone");
    expect((await sim.facts()).gameMode).toBe(!call.enabled);
    expect((await client.redo(id, change.id)).status).toBe("applied");
    expect((await sim.facts()).gameMode).toBe(call.enabled);
    client.stop();
  });

  it("puts earlier steps back when a later one fails", async () => {
    const { client, sim } = setup({
      apply: async (c) => { if (c.kind === "display.refreshRate") throw new Error("The display said no."); return sim.apply(c); },
    });
    await client.start();
    const before = await sim.facts();
    const calls: ActionCall[] = [{ kind: "windows.gameMode", enabled: !before.gameMode }, { kind: "display.refreshRate", display: fixtures.atlas.inv.displays[0].name, hz: 165 }];
    await expect(client.apply(client.id, calls, { by: "rig" })).rejects.toThrow(/Nothing was changed/);
    expect((await sim.facts()).gameMode).toBe(before.gameMode);
    expect(await client.changes(client.id)).toHaveLength(0);
    client.stop();
  });

  it("refuses anything outside the fix catalog", async () => {
    const { client } = setup();
    await client.start();
    await expect(client.preview(client.id, [{ kind: "registry.write", key: "x" } as unknown as ActionCall])).rejects.toThrow();
    client.stop();
  });

  it("keeps one history point per window with the highest temperatures", async () => {
    const { client, store, advance } = setup();
    await client.start();
    for (let i = 0; i < 6; i++) { advance(2 * 60_000); await client.tick(); }
    const pts = await store.history(0);
    expect(pts).toHaveLength(1);
    expect(pts[0].cpu).toBeGreaterThan(30);
    expect(await client.history(client.id, "24h")).toHaveLength(1);
    client.stop();
  });

  it("keeps the fastest fan and the game played most in each window", async () => {
    const reads: { game: string | null; fans: number[] }[] = [
      { game: null, fans: [900, 0] },
      { game: "Hades II", fans: [1400, 2100] },
      { game: "Hades II", fans: [1300, 1900] },
      { game: "Balatro", fans: [1000, 800] },
      { game: null, fans: [700, 0] },
    ];
    let i = 0;
    const snapshot = async (): Promise<Snapshot> => {
      const r = reads[Math.min(i++, reads.length - 1)];
      return {
        at: 0, elevated: true, game: r.game,
        sensors: r.fans.map((rpm, n) => ({ id: `/fan/${n}`, hw: "board", hwName: "Board", type: "fan", name: `Fan #${n + 1}`, value: rpm })),
      };
    };
    const { client, store, advance } = setup({ snapshot });
    await client.start();
    for (let n = 0; n < 5; n++) { advance(2 * 60_000); await client.tick(); }
    const [p] = await store.history(0);
    expect(p).toMatchObject({ fan: 2100, game: "Hades II", busy: true, cpu: null, gpu: null });
    client.stop();
  });

  it("records no fan or game when the PC reports neither", async () => {
    const quiet = async (): Promise<Snapshot> => ({ at: 0, elevated: true, sensors: [{ id: "/fan/0", hw: "gpu", hwName: "GPU", type: "fan", name: "GPU Fan", value: 0 }] });
    const { client, store, advance } = setup({ snapshot: quiet });
    await client.start();
    for (let n = 0; n < 6; n++) { advance(2 * 60_000); await client.tick(); }
    expect((await store.history(0))[0]).toMatchObject({ fan: null, game: null, busy: false });
    client.stop();
  });

  it("uploads to the account and asks to sign in before chatting", async () => {
    const synced: MachineSync[] = [];
    const cloud = { signedIn: async () => true, sync: async (_id: string, p: MachineSync) => { synced.push(p); }, machines: async () => [], account: async () => null } as unknown as CloudClient;
    const { client } = setup({}, cloud);
    await client.start();
    await vi.waitFor(() => expect(synced.length).toBeGreaterThan(0));
    expect(synced[0].view.id).toBe(client.id);
    client.stop();

    const off = setup();
    const events: ChatEvent[] = [];
    await off.client.chat(off.client.id, [{ id: "1", from: "you", text: "hi" }], (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("exports this PC from disk when signed out, and the account when signed in", async () => {
    const { client, advance } = setup();
    await client.start();
    for (let i = 0; i < 3; i++) { advance(10 * 60_000); await client.tick(); }
    const out = await client.exportData();
    client.stop();
    expect(out.account).toBeNull();
    expect(out.machines).toHaveLength(1);
    expect(out.machines[0].id).toBe(client.id);
    expect(out.machines[0].history.length).toBeGreaterThan(0);
    expect(client.deleteAccount).toBeUndefined();

    const fromServer = { format: "rig-export/1", machines: [] };
    const cloud = { signedIn: async () => true, exportData: async () => fromServer, sync: async () => ({ identity: {} }), deleteAccount: vi.fn(async () => {}) } as unknown as CloudClient;
    const on = setup({}, cloud);
    expect(await on.client.exportData()).toBe(fromServer);
    await on.client.deleteAccount!();
    expect(cloud.deleteAccount).toHaveBeenCalledTimes(1);
  });
});
