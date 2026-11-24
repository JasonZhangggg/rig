import { describe, expect, it, vi } from "vitest";
import { APPROVE_DECLINED, KEEP_OFF_CHAT, STEP_DIFFERS, type ProtectionState, checkStep, stepHash, fixSteps, LocalClient, MemoryStore, type ActionCall, type Allowed, type ApplyReply, type ChatEvent, type ChatMessage, type Command, type StepRpc, type HelperLink, type HelperStep, type MachineSync, type PC, type PcRead, type PcReadResult, type PcReadSpec, type PreviewReply, type Snapshot, type Step, type UndoReply } from "../src";
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

  it("reads only new Windows events after the first read, and keeps the earlier ones", async () => {
    const at = new Date("2026-11-17T20:00:00").getTime();
    const ev = (t: number, id: number) => ({ t, log: "System" as const, source: "Microsoft-Windows-Kernel-Power", id, level: "critical" as const, message: "The system has rebooted without cleanly shutting down first." });
    const asked: number[] = [];
    let log = [ev(at - 4 * 864e5, 41), ev(at - 864e5, 41)];
    const { client, advance } = setup({ events: async (since) => { asked.push(since); return log.filter((e) => e.t >= since); } });
    const id = fixtures.atlas.inv.machine.id;
    expect(await client.events(id)).toHaveLength(2);
    // Six minutes on, one new event: the read asks from the newest held one (less a minute), not a month back.
    advance(6 * 60_000);
    log = [...log, ev(at + 5 * 60_000, 6008)];
    const all = await client.events(id);
    client.stop();
    expect(asked[0]).toBe(at - 30 * 864e5);
    expect(asked[1]).toBe(at - 864e5 - 60_000);
    expect(all.map((e) => e.t)).toEqual([at + 5 * 60_000, at - 864e5, at - 4 * 864e5]);
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
    const rows = await client.preview(id, fixSteps([call]));
    expect(rows[0][0]).toMatch(/game mode/i);

    const change = await client.apply(id, fixSteps([call]), { by: "you" });
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
    await expect(client.apply(client.id, fixSteps(calls), { by: "rig" })).rejects.toThrow(/Nothing was changed/);
    expect((await sim.facts()).gameMode).toBe(before.gameMode);
    expect(await client.changes(client.id)).toHaveLength(0);
    client.stop();
  });

  it("keeps the tier and the chat answer a change came from", async () => {
    const { client, sim } = setup();
    await client.start();
    const call: ActionCall = { kind: "windows.gameMode", enabled: !(await sim.facts()).gameMode };
    const change = await client.apply(client.id, fixSteps([call]), { by: "rig", from: { proposalId: "p1", messageId: "m1" } });
    expect((await client.changes(client.id))[0]).toMatchObject({ id: change.id, tier: 1, from: { proposalId: "p1", messageId: "m1" }, applied: [{ step: { kind: "fix", call } }] });
    client.stop();
  });

  it("reads, undoes and redoes a change stored before steps", async () => {
    const { client, store, sim } = setup();
    await client.start();
    const was = (await sim.facts()).gameMode;
    const call: ActionCall = { kind: "windows.gameMode", enabled: !was };
    await sim.apply(call);
    const row: [string, string, string] = ["Game Mode", was ? "On" : "Off", was ? "Off" : "On"];
    await store.putChange({ id: "old", machineId: client.id, at: "2026-11-01T10:00:00.000Z", title: "Turned Game Mode on", by: "you", status: "applied", why: "", result: "", diff: [row],
      applied: [{ call, undo: { kind: "windows.gameMode", enabled: was }, row }] });
    expect((await client.changes(client.id))[0]).toMatchObject({ tier: 1, applied: [{ step: { kind: "fix", call }, undo: { kind: "fix", call: { kind: "windows.gameMode", enabled: was } }, rows: [row] }] });
    expect((await client.undo(client.id, "old")).status).toBe("undone");
    expect((await sim.facts()).gameMode).toBe(was);
    expect((await client.redo(client.id, "old")).status).toBe("applied");
    expect((await sim.facts()).gameMode).toBe(!was);
    client.stop();
  });

  it("makes a command step only from its own card, not with Rig's fixes", async () => {
    const { client, sim } = setup();
    await client.start();
    const was = (await sim.facts()).gameMode;
    const steps: Step[] = [...fixSteps([{ kind: "windows.gameMode", enabled: !was }]), { kind: "command", cmd: { does: "Turns off menu delay.", read: "Get-Date", run: "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 0", touches: [{ kind: "registry", key: "HKCU\\Control Panel\\Desktop" }] } }];
    await expect(client.preview(client.id, steps)).rejects.toThrow("A command step runs from its own card in the chat.");
    await expect(client.apply(client.id, steps, { by: "rig" })).rejects.toThrow("A command step runs from its own card in the chat.");
    expect((await sim.facts()).gameMode).toBe(was);
    expect(await client.changes(client.id)).toHaveLength(0);
    client.stop();
  });

  it("refuses anything outside the fix catalog", async () => {
    const { client } = setup();
    await client.start();
    await expect(client.preview(client.id, fixSteps([{ kind: "registry.write", key: "x" } as unknown as ActionCall]))).rejects.toThrow();
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

  it("runs the chat's reads through the helper and goes on with what they found", async () => {
    const asks: { resume?: { resume: string; results: PcReadResult[] }; live?: { reads?: boolean; steps?: boolean } }[] = [];
    const cloud = {
      signedIn: async () => true, sync: async () => ({ identity: {} }), machines: async () => [], account: async () => null,
      chat: async (_id: string, _h: ChatMessage[], onEvent: (e: ChatEvent) => void, _s: AbortSignal | undefined, live: { reads?: boolean; steps?: boolean }, resume?: { resume: string; results: PcReadResult[] }) => {
        asks.push({ resume, live });
        if (!resume) {
          onEvent({ type: "text", text: "Let me look." });
          onEvent({ type: "reads", resume: "signed-state", reads: [
            { id: "r1", kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "WallPaper" },
            { id: "r2", kind: "script", script: "Remove-Item -Path 'C:\\Temp' -Recurse" },
            { id: "r3", kind: "cim", class: "Win32_BIOS" },
          ] });
          return;
        }
        onEvent({ type: "text", text: " The wallpaper is set." });
        onEvent({ type: "done" });
      },
    } as unknown as CloudClient;
    const read = vi.fn(async (r: PcReadSpec) => {
      if (r.kind === "cim") throw new Error("WMI isn't answering.");
      return '{"data":"C:\\\\Pictures\\\\sea.jpg"}';
    });
    const { client } = setup({ read }, cloud);
    await client.start();
    const events: ChatEvent[] = [];
    await client.chat(client.id, [{ id: "1", from: "you", text: "What's my wallpaper?" }], (e) => events.push(e));
    client.stop();

    expect(asks).toHaveLength(2);
    expect(asks[0].live?.reads).toBe(true);
    // This app shows command steps, so the server may offer them; older apps don't say so and only get fixes.
    expect(asks[0].live?.steps).toBe(true);
    expect(asks[1].resume?.resume).toBe("signed-state");
    // The helper only got the reads that check as reads here too, without the server's ids.
    expect(read.mock.calls.map(([r]) => r)).toEqual([{ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "WallPaper" }, { kind: "cim", class: "Win32_BIOS" }]);
    const results = asks[1].resume!.results;
    expect(results[0]).toEqual({ id: "r1", ok: true, text: '{"data":"C:\\\\Pictures\\\\sea.jpg"}' });
    expect(results[1]).toMatchObject({ id: "r2", ok: false });
    expect(results[2]).toEqual({ id: "r3", ok: false, error: "WMI isn't answering." });
    // The person sees one answer; the stop in the middle stays between the app and the server.
    expect(events.map((e) => e.type)).toEqual(["text", "text", "done"]);
  });

  it("tells the server it can't read live when the helper is older", async () => {
    let live: { reads?: boolean } | undefined;
    const cloud = {
      signedIn: async () => true, sync: async () => ({ identity: {} }), machines: async () => [], account: async () => null,
      chat: async (_id: string, _h: ChatMessage[], onEvent: (e: ChatEvent) => void, _s: unknown, l: { reads?: boolean }) => { live = l; onEvent({ type: "done" }); },
    } as unknown as CloudClient;
    const { client } = setup({}, cloud);
    await client.start();
    await client.chat(client.id, [{ id: "1", from: "you", text: "hi" }], () => {});
    client.stop();
    expect(live).toBeDefined();
    expect(live?.reads).toBeUndefined();
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
  it("keeps at most five days of history for the account while signed out", async () => {
    let signedIn = false;
    const synced: MachineSync[] = [];
    const cloud = { signedIn: async () => signedIn, sync: async (_id: string, p: MachineSync) => { synced.push(p); }, machines: async () => [], account: async () => null } as unknown as CloudClient;
    const { client, advance } = setup({}, cloud);
    await client.start();
    // About five and a half days of history windows with nobody signed in.
    for (let n = 0; n < 1600; n++) { advance(10 * 60_000); await client.tick(); }
    signedIn = true;
    await client.sync();
    client.stop();
    expect(synced.at(-1)!.history.length).toBe(720);
  });

  it("reads less often and stays still on screen while the window is hidden, but still passes on alerts", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      let t = new Date("2026-11-17T20:00:00").getTime();
      let hot = false;
      const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
      let settingsReads = 0;
      const link: HelperLink = {
        hello: () => sim.hello(), apply: (c) => sim.apply(c),
        inventory: () => { settingsReads++; return sim.inventory(); },
        facts: () => { settingsReads++; return sim.facts(); },
        snapshot: async () => {
          reads++;
          const s = await sim.snapshot();
          // The processor at its limit, for long enough to raise an alert.
          return hot ? { ...s, sensors: s.sensors.map((x) => x.hw === "cpu" && x.type === "temperature" ? { ...x, value: 105 } : x) } : s;
        },
      };
      const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 2000, quietTickMs: 10_000, now: () => t });
      const seen: PC[] = [];
      const stop = client.watch(fixtures.atlas.inv.machine.id, (pc) => seen.push(pc));
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      const run = async (ms: number) => { for (let i = 0; i < ms / 1000; i++) { t += 1000; await vi.advanceTimersByTimeAsync(1000); } };

      reads = 0;
      await run(20_000);
      expect(reads).toBe(10);

      client.setQuiet(true);
      const shown = seen.length;
      reads = 0;
      settingsReads = 0;
      await run(60_000);
      expect(reads).toBe(6);
      expect(seen.length).toBe(shown);
      // Settings and parts only feed the screens, so they aren't read while hidden either.
      expect(settingsReads).toBe(0);

      // An alert starting while hidden still reaches the notifications.
      hot = true;
      await run(4 * 60_000);
      expect(seen.length).toBe(shown + 1);
      expect(seen.at(-1)!.alerts?.some((a) => a.kind === "too-hot")).toBe(true);

      // Shown again: the screen is brought up to date at once, then follows every reading.
      client.setQuiet(false);
      expect(seen.length).toBe(shown + 2);
      expect(settingsReads).toBeGreaterThan(0);
      reads = 0;
      await run(10_000);
      expect(reads).toBeGreaterThanOrEqual(5);
      stop();
      client.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("command steps", () => {
    const menuDelay: Command = {
      does: "Turns off the menu delay.",
      read: "Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay",
      run: "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 0",
      undo: "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 400",
      touches: [{ kind: "registry", key: "HKCU:\\Control Panel\\Desktop", value: "MenuShowDelay" }],
    };
    const run = { before: "MenuShowDelay : 400", after: "MenuShowDelay : 0", output: "", alsoChanged: [], touches: [{ touch: { kind: "registry" as const, key: "HKCU\\Control Panel\\Desktop", value: "MenuShowDelay" }, before: "400", after: "0" }] };
    const undoRecord = { kind: "command" as const, id: "u1", script: menuDelay.undo!, outside: [], fingerprint: "f1" };

    /** A helper that answers command calls the way the runner does, and remembers every call in order. */
    function commandHelper(o: { admin?: boolean; drifts?: string[]; storedHash?: string; protections?: () => ProtectionState } = {}) {
      const calls: string[] = [];
      const seen: { method: string; params: unknown }[] = [];
      let drifted = !!o.drifts;
      let previewed: HelperStep | null = null;
      const command = async <K extends keyof StepRpc>(method: K, params: StepRpc[K]["params"]): Promise<StepRpc[K]["reply"]> => {
        calls.push(method);
        seen.push({ method, params });
        let reply: unknown;
        if (method === "step.preview") {
          previewed = (params as { step: HelperStep }).step;
          const v = checkStep(previewed, { tainted: false, own: true }) as Allowed;
          reply = { outcome: "ready", nonce: "n1", expiresAt: "2026-11-17T20:10:00.000Z", verdict: { ...v, admin: !!o.admin }, read: run.before, touches: [{ touch: run.touches[0].touch, value: "400" }], hash: o.storedHash ?? (await stepHash(previewed)) } satisfies PreviewReply;
        } else if (method === "step.apply") reply = { outcome: "applied", result: run, undo: previewed?.kind === "native" ? { kind: "native", id: "u1", outside: [], fingerprint: "f1" } : undoRecord } satisfies ApplyReply;
        else if (method === "step.undo") {
          const force = (params as { force?: boolean }).force;
          reply = (drifted && !force ? { outcome: "drifted", changed: o.drifts! } : { outcome: "undone", printed: run.before, left: [] }) satisfies UndoReply;
          if (force) drifted = false;
        } else if (method === "command.read") reply = { printed: "MenuShowDelay : 400" };
        else if (method === "protection.state") reply = o.protections?.();
        return reply as StepRpc[K]["reply"];
      };
      return { command, calls, seen };
    }

    function withCommands(o: { admin?: boolean; drifts?: string[]; storedHash?: string; protections?: () => ProtectionState; approve?: (nonce: string, hash: string) => Promise<void> } = {}) {
      const helper = commandHelper(o);
      const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => 0 });
      const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), step: helper.command };
      const approve = vi.fn(o.approve ?? (async (_nonce: string, _hash: string) => { helper.calls.push("approve"); }));
      const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => new Date("2026-11-17T20:00:00").getTime(), approveStep: approve });
      return { client, helper, approve };
    }
    const meta = { title: "Turns off the menu delay", by: "rig" as const, from: { proposalId: "p1", messageId: "m1" } };

    it("previews, applies and undoes a command that needs no admin rights, and logs it once", async () => {
      const { client, helper, approve } = withCommands();
      await client.start();
      const preview = await client.previewStep(client.id, { kind: "command", cmd: menuDelay }, false);
      expect(preview).toMatchObject({ outcome: "ready", nonce: "n1", read: "MenuShowDelay : 400" });
      // The helper gets the command as Rig stores it: registry keys written HKCU\.
      expect((helper.seen[0].params as { step: { cmd: Command } }).step.cmd.touches[0]).toEqual({ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "MenuShowDelay" });
      const applied = await client.applyStep(client.id, "n1", meta);
      expect(applied.outcome).toBe("applied");
      expect(approve).not.toHaveBeenCalled();
      const [change, ...rest] = await client.changes(client.id);
      expect(rest).toHaveLength(0);
      expect(change).toMatchObject({
        title: "Turns off the menu delay", status: "applied", tier: (preview as Extract<PreviewReply, { outcome: "ready" }>).verdict.tier, from: meta.from,
        diff: [["HKCU\\Control Panel\\Desktop\\MenuShowDelay", "400", "0"]],
        applied: [{ step: { kind: "command" }, undo: { kind: "command", id: "u1" }, verify: { before: "MenuShowDelay : 400", after: "MenuShowDelay : 0" } }],
      });
      // A nonce works once.
      expect((await client.applyStep(client.id, "n1", meta)).outcome).toBe("expired");
      expect((await client.undoStep(client.id, "u1")).outcome).toBe("undone");
      expect((await client.changes(client.id)).map((c) => c.status)).toEqual(["undone"]);
      expect(helper.calls).toEqual(["step.preview", "step.apply", "step.undo"]);
      client.stop();
    });

    it("takes a native step through the same preview, apply and undo, as the helper stores it", async () => {
      const { client, helper, approve } = withCommands();
      await client.start();
      const sent = { kind: "native", op: { name: "selftest", value: "rig", extra: "dropped" } } as unknown as HelperStep;
      expect((await client.previewStep(client.id, sent, false)).outcome).toBe("ready");
      expect(helper.seen[0].params).toEqual({ step: { kind: "native", op: { name: "selftest", value: "rig" } } });
      expect((await client.applyStep(client.id, "n1", { by: "rig" })).outcome).toBe("applied");
      expect(approve).not.toHaveBeenCalled();
      const [change] = await client.changes(client.id);
      expect(change).toMatchObject({ title: "Ran Rig's self-test change", status: "applied", tier: 2, applied: [{ step: { kind: "native", op: { name: "selftest" } }, undo: { kind: "native", id: "u1" } }] });
      expect((await client.undoStep(client.id, "u1")).outcome).toBe("undone");
      expect(helper.calls).toEqual(["step.preview", "step.apply", "step.undo"]);
      await expect(client.redo(client.id, change.id)).rejects.toThrow("only from a new card");
      client.stop();
    });

    it("logs a file edit with each value's file, place, before and after, as the helper read them", async () => {
      const path = "C:\\Users\\Sam\\AppData\\Roaming\\Game\\settings.json";
      const before = 'graphics › vsync: true\nFile fingerprint 0123456789ab, 80 bytes\n\nLine 3:\n-     "vsync": true\n+     "vsync": false';
      const after = "graphics › vsync: false\nFile fingerprint ba9876543210, 81 bytes";
      const touch = { kind: "file" as const, path };
      const seen: unknown[] = [];
      const step: StepRpc["step.preview"]["params"]["step"] = { kind: "native", op: { name: "fileEdit", does: "Turns off vertical sync.", path, format: "json", edits: [{ at: ["graphics", "vsync"], value: false }] } };
      const helper = async <K extends keyof StepRpc>(method: K, params: StepRpc[K]["params"]): Promise<StepRpc[K]["reply"]> => {
        seen.push({ method, params });
        const replies: Partial<{ [M in keyof StepRpc]: StepRpc[M]["reply"] }> = {
          "step.preview": { outcome: "ready", nonce: "n1", expiresAt: "2026-11-17T20:10:00.000Z", verdict: checkStep(step) as Allowed, read: before, touches: [{ touch, value: "80 bytes, fingerprint 0123456789ab" }], hash: method === "step.preview" ? await stepHash((params as { step: HelperStep }).step) : "" },
          "step.apply": { outcome: "applied", result: { before, after, output: "", alsoChanged: [], touches: [{ touch, before: "80 bytes, fingerprint 0123456789ab", after: "81 bytes, fingerprint ba9876543210" }] }, undo: { kind: "native", id: "u1", outside: [], fingerprint: "f1" } },
        };
        return replies[method] as StepRpc[K]["reply"];
      };
      const { client } = setup({ step: helper });
      await client.start();
      expect(await client.previewStep(client.id, step, false)).toMatchObject({ outcome: "ready", verdict: { tier: 1 }, read: before });
      expect((await client.applyStep(client.id, "n1", { by: "rig" })).outcome).toBe("applied");
      const [change] = await client.changes(client.id);
      expect(change).toMatchObject({ title: "Changed a value in settings.json", tier: 1, diff: [["settings.json › graphics › vsync", "true", "false"]], applied: [{ undo: { kind: "native", id: "u1" } }] });
      expect(seen).toHaveLength(2);
      client.stop();
    });

    it("shows no card when the helper stored a step this app fingerprints differently", async () => {
      const { client, helper } = withCommands({ storedHash: "0".repeat(64) });
      await client.start();
      expect(await client.previewStep(client.id, { kind: "command", cmd: menuDelay }, false)).toMatchObject({ outcome: "refused", verdict: { refused: STEP_DIFFERS } });
      expect(await client.applyStep(client.id, "n1", meta)).toEqual({ outcome: "expired" });
      expect(helper.calls).toEqual(["step.preview"]);
      client.stop();
    });

    it("refuses a native step Rig doesn't know before the helper sees it", async () => {
      const { client, helper } = withCommands();
      await client.start();
      const unknown = { kind: "native", op: { name: "format-disk" } } as unknown as HelperStep;
      expect(await client.previewStep(client.id, unknown, false)).toMatchObject({ outcome: "refused", verdict: { refused: "This isn't a kind of change Rig makes." } });
      expect(helper.calls).toEqual([]);
      client.stop();
    });

    it("logs a protection turned off with when it comes back on, and follows what the helper says became of it", async () => {
      let state: ProtectionState = { ledger: true, rows: [{ id: "firewallPublic", on: false, due: "2026-11-17T21:14:00.000Z" }] };
      const { client, helper, approve } = withCommands({ admin: true, protections: () => state });
      await client.start();
      const off: HelperStep = { kind: "native", op: { name: "protection", id: "firewallPublic", revertAfter: 15 } };
      expect((await client.previewStep(client.id, off, false)).outcome).toBe("ready");
      expect((await client.applyStep(client.id, "n1", { by: "rig" })).outcome).toBe("applied");
      expect(approve).toHaveBeenCalledTimes(1);
      const now = async () => (await client.changes(client.id))[0];
      expect(await now()).toMatchObject({ title: "Turned off Windows Firewall on public networks for 15 minutes", status: "applied", tier: 3, revert: { due: "2026-11-17T21:14:00.000Z" } });
      // The person chose to keep it off: the service holds nothing for it any more.
      state = { ledger: true, rows: [{ id: "firewallPublic", on: false }] };
      expect((await now()).revert).toEqual({ due: null });
      // A helper without admin rights can't read the service's list, and that changes nothing in the log.
      state = { ledger: false, rows: [{ id: "firewallPublic", on: false }] };
      expect((await now()).revert).toEqual({ due: null });
      state = { ledger: true, rows: [{ id: "firewallPublic", on: true, last: { at: "2026-11-17T21:14:01.000Z", why: "due", was: "off" } }] };
      expect(await now()).toMatchObject({ status: "undone", result: "Rig turned it back on when its time was up." });
      expect(helper.calls.filter((c) => c !== "protection.state")).toEqual(["step.preview", "approve", "step.apply"]);
      client.stop();
    });

    it("asks the helper to keep a protection off only for Rig's own button", async () => {
      const { client, helper } = withCommands({ admin: true });
      await client.start();
      const keep: HelperStep = { kind: "native", op: { name: "keepOff", id: "firewallPublic" } };
      expect(await client.previewStep(client.id, keep, false)).toMatchObject({ outcome: "refused", verdict: { refused: KEEP_OFF_CHAT } });
      expect(helper.calls).toEqual([]);
      expect((await client.previewStep(client.id, keep, false, true)).outcome).toBe("ready");
      expect(helper.seen[0].params).toEqual({ step: keep });
      client.stop();
    });

    it("has Windows approve an admin command by its nonce and hash before it runs", async () => {
      const { client, helper, approve } = withCommands({ admin: true });
      await client.start();
      await client.previewStep(client.id, { kind: "command", cmd: menuDelay }, false);
      expect((await client.applyStep(client.id, "n1", meta)).outcome).toBe("applied");
      const stored = (helper.seen[0].params as { step: Step }).step;
      expect(approve).toHaveBeenCalledWith("n1", await stepHash(stored));
      expect(await stepHash(stored)).not.toBe(await stepHash({ kind: "command", cmd: menuDelay }));
      expect(helper.calls).toEqual(["step.preview", "approve", "step.apply"]);
      expect(await client.changes(client.id)).toHaveLength(1);
      client.stop();
    });

    it("changes nothing when the person says No at Windows' prompt, and can ask again", async () => {
      let answer: "no" | "yes" = "no";
      const { client, helper } = withCommands({ admin: true, approve: async () => { if (answer === "no") throw APPROVE_DECLINED; } });
      await client.start();
      await client.previewStep(client.id, { kind: "command", cmd: menuDelay }, false);
      expect(await client.applyStep(client.id, "n1", meta)).toEqual({ outcome: "declined" });
      expect(helper.calls).not.toContain("step.apply");
      expect(await client.changes(client.id)).toHaveLength(0);
      answer = "yes";
      expect((await client.applyStep(client.id, "n1", meta)).outcome).toBe("applied");
      expect(await client.changes(client.id)).toHaveLength(1);
      client.stop();
    });

    it("says a plain error when Windows' approval fails for another reason", async () => {
      const { client, helper } = withCommands({ admin: true, approve: async () => { throw "Rig's helper didn't start."; } });
      await client.start();
      await client.previewStep(client.id, { kind: "command", cmd: menuDelay }, false);
      await expect(client.applyStep(client.id, "n1", meta)).rejects.toThrow("Rig's helper didn't start.");
      expect(helper.calls).not.toContain("step.apply");
      client.stop();
    });

    it("won't put a change back over something that changed it since, until asked to anyway", async () => {
      const { client, helper } = withCommands({ drifts: ["HKCU\\Control Panel\\Desktop\\MenuShowDelay"] });
      await client.start();
      await client.previewStep(client.id, { kind: "command", cmd: menuDelay }, false);
      await client.applyStep(client.id, "n1", meta);
      expect(await client.undoStep(client.id, "u1")).toEqual({ outcome: "drifted", changed: ["HKCU\\Control Panel\\Desktop\\MenuShowDelay"] });
      expect((await client.changes(client.id))[0].status).toBe("applied");
      expect((await client.undoStep(client.id, "u1", true)).outcome).toBe("undone");
      expect((await client.changes(client.id))[0].status).toBe("undone");
      expect(helper.seen.filter((c) => c.method === "step.undo").map((c) => c.params)).toEqual([{ id: "u1" }, { id: "u1", force: true }]);
      client.stop();
    });

    it("refuses a tier 3 command after the chat read outside text, before the helper sees it", async () => {
      const { client, helper } = withCommands();
      await client.start();
      const noUndo: Command = { ...menuDelay, undo: null, touches: [{ kind: "other", name: "The menu delay" }] };
      expect(await client.previewStep(client.id, { kind: "command", cmd: noUndo }, true)).toMatchObject({ outcome: "refused", verdict: { why: "tainted" } });
      expect(helper.calls).toHaveLength(0);
      client.stop();
    });

    it("runs the chat's script and command reads through the helper's command read", async () => {
      const asked: PcReadResult[][] = [];
      const cloud = {
        signedIn: async () => true, sync: async () => ({ identity: {} }), machines: async () => [], account: async () => null,
        chat: async (_id: string, _h: ChatMessage[], onEvent: (e: ChatEvent) => void, _s: unknown, _l: unknown, resume?: { results: PcReadResult[] }) => {
          if (resume) { asked.push(resume.results); onEvent({ type: "done" }); return; }
          onEvent({ type: "reads", resume: "s", reads: [{ id: "a", kind: "cmdlet", command: "Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay" }, { id: "b", kind: "script", script: "Get-Service -Name wuauserv" }] });
        },
      } as unknown as CloudClient;
      const helper = commandHelper();
      const read = vi.fn(async () => "never");
      const { client } = setup({ read, step: helper.command }, cloud);
      await client.start();
      await client.chat(client.id, [{ id: "1", from: "you", text: "What's my menu delay?" }], () => {});
      client.stop();
      expect(read).not.toHaveBeenCalled();
      expect(helper.seen.map((c) => c.params)).toEqual([{ script: "Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay" }, { script: "Get-Service -Name wuauserv" }]);
      expect(asked[0]).toEqual([{ id: "a", ok: true, text: "MenuShowDelay : 400" }, { id: "b", ok: true, text: "MenuShowDelay : 400" }]);
    });

    it("looks in an app's window through the helper, sends what it parsed, and previews a step only from a look it holds", async () => {
      const lookId = "0123456789abcdef0123456789abcdef";
      const look = { lookId, path: ["NVIDIA Control Panel", "Change resolution", "Output dynamic range"], value: "Limited", options: ["Limited", "Full"], clean: true, expiresAt: "2099-01-01T00:00:00.000Z" };
      const asked: PcReadResult[][] = [];
      const cloud = {
        signedIn: async () => true, sync: async () => ({ identity: {} }), machines: async () => [], account: async () => null,
        chat: async (_id: string, _h: ChatMessage[], onEvent: (e: ChatEvent) => void, _s: unknown, _l: unknown, resume?: { results: PcReadResult[] }) => {
          if (resume) { asked.push(resume.results); onEvent({ type: "done" }); return; }
          onEvent({ type: "reads", resume: "s", reads: [
            { id: "a", kind: "screen", app: "NVIDIA Control Panel", goal: ["Change resolution", "Output dynamic range"] },
            { id: "b", kind: "screen", app: "NVIDIA Control Panel", goal: ["Broken"] },
            { id: "c", kind: "screen", app: "C:\\Windows\\regedit.exe", goal: ["HKEY_LOCAL_MACHINE"] } as unknown as PcRead,
          ] });
        },
      } as unknown as CloudClient;
      const seen: { method: string; params: unknown }[] = [];
      const step: HelperStep = { kind: "native", op: { name: "screen", lookId, to: "Full", does: "Sets the output dynamic range to Full." } };
      const helper = async <K extends keyof StepRpc>(method: K, params: StepRpc[K]["params"]): Promise<StepRpc[K]["reply"]> => {
        seen.push({ method, params });
        if (method === "screen.look") return ((params as { goal: string[] }).goal[0] === "Broken" ? { lookId: "nope", path: [], extra: true } : { ...look, hops: [{ name: "Change resolution" }] }) as unknown as StepRpc[K]["reply"];
        return { outcome: "ready", nonce: "n1", expiresAt: "2026-11-17T20:10:00.000Z", verdict: checkStep(step, { tainted: false, looks: [look] }) as Allowed, read: "Output dynamic range: Limited", touches: [], hash: await stepHash(step) } as StepRpc[K]["reply"];
      };
      const { client } = setup({ step: helper }, cloud);
      await client.start();
      expect(await client.previewStep(client.id, step, false)).toMatchObject({ outcome: "refused", verdict: { refused: expect.stringContaining("hasn't looked") } });
      await client.chat(client.id, [{ id: "1", from: "you", text: "Blacks look grey" }], () => {});
      expect(seen.map((c) => c.params)).toEqual([{ app: "NVIDIA Control Panel", goal: ["Change resolution", "Output dynamic range"] }, { app: "NVIDIA Control Panel", goal: ["Broken"] }]);
      expect(asked[0][0]).toEqual({ id: "a", ok: true, text: expect.stringContaining("Path: Change resolution › Output dynamic range"), look });
      expect(asked[0][1]).toEqual({ id: "b", ok: false, error: "Rig's helper answered with something that isn't a look." });
      expect(asked[0][2]).toMatchObject({ id: "c", ok: false });
      expect(await client.previewStep(client.id, step, false)).toMatchObject({ outcome: "ready", verdict: { tier: 3 } });
      expect(await client.previewStep(client.id, { kind: "native", op: { ...step.op, to: "Half" } } as HelperStep, false)).toMatchObject({ outcome: "refused", verdict: { refused: expect.stringContaining("offered") } });
      client.stop();
    });
  });
});
