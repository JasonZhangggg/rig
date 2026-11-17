import { describe, expect, it, vi } from "vitest";
import { LocalClient, MemoryStore, type ActionCall, type ChatEvent, type HelperLink, type MachineSync } from "../src";
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
});
