import { describe, expect, it, vi } from "vitest";
import { APPROVE_DECLINED, checkStep, commandHash, fixSteps, LocalClient, MemoryStore, type ActionCall, type Allowed, type ApplyReply, type ChatEvent, type ChatMessage, type Command, type CommandRpc, type HelperLink, type MachineSync, type PC, type PcReadResult, type PcReadSpec, type PreviewReply, type Snapshot, type Step, type UndoReply } from "../src";
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
    function commandHelper(o: { admin?: boolean; drifts?: string[] } = {}) {
      const calls: string[] = [];
      const seen: { method: string; params: unknown }[] = [];
      let drifted = !!o.drifts;
      const command = async <K extends keyof CommandRpc>(method: K, params: CommandRpc[K]["params"]): Promise<CommandRpc[K]["reply"]> => {
        calls.push(method);
        seen.push({ method, params });
        let reply: unknown;
        if (method === "command.preview") {
          const v = checkStep({ kind: "command", cmd: (params as { cmd: Command }).cmd }) as Allowed;
          reply = { outcome: "ready", nonce: "n1", expiresAt: "2026-11-17T20:10:00.000Z", verdict: { ...v, admin: !!o.admin }, read: run.before, touches: [{ touch: run.touches[0].touch, value: "400" }] } satisfies PreviewReply;
        } else if (method === "command.apply") reply = { outcome: "applied", result: run, undo: undoRecord } satisfies ApplyReply;
        else if (method === "command.undo") {
          const force = (params as { force?: boolean }).force;
          reply = (drifted && !force ? { outcome: "drifted", changed: o.drifts! } : { outcome: "undone", printed: run.before, left: [] }) satisfies UndoReply;
          if (force) drifted = false;
        } else if (method === "command.read") reply = { printed: "MenuShowDelay : 400" };
        return reply as CommandRpc[K]["reply"];
      };
      return { command, calls, seen };
    }

    function withCommands(o: { admin?: boolean; drifts?: string[]; approve?: (nonce: string, hash: string) => Promise<void> } = {}) {
      const helper = commandHelper(o);
      const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => 0 });
      const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), command: helper.command };
      const approve = vi.fn(o.approve ?? (async (_nonce: string, _hash: string) => { helper.calls.push("approve"); }));
      const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => new Date("2026-11-17T20:00:00").getTime(), approveCommand: approve });
      return { client, helper, approve };
    }
    const meta = { title: "Turns off the menu delay", by: "rig" as const, from: { proposalId: "p1", messageId: "m1" } };

    it("previews, applies and undoes a command that needs no admin rights, and logs it once", async () => {
      const { client, helper, approve } = withCommands();
      await client.start();
      const preview = await client.previewCommand(client.id, menuDelay, false);
      expect(preview).toMatchObject({ outcome: "ready", nonce: "n1", read: "MenuShowDelay : 400" });
      // The helper gets the command as Rig stores it: registry keys written HKCU\.
      expect((helper.seen[0].params as { cmd: Command }).cmd.touches[0]).toEqual({ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "MenuShowDelay" });
      const applied = await client.applyCommand(client.id, "n1", meta);
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
      expect((await client.applyCommand(client.id, "n1", meta)).outcome).toBe("expired");
      expect((await client.undoCommand(client.id, "u1")).outcome).toBe("undone");
      expect((await client.changes(client.id)).map((c) => c.status)).toEqual(["undone"]);
      expect(helper.calls).toEqual(["command.preview", "command.apply", "command.undo"]);
      client.stop();
    });

    it("has Windows approve an admin command by its nonce and hash before it runs", async () => {
      const { client, helper, approve } = withCommands({ admin: true });
      await client.start();
      await client.previewCommand(client.id, menuDelay, false);
      expect((await client.applyCommand(client.id, "n1", meta)).outcome).toBe("applied");
      const stored = (helper.seen[0].params as { cmd: Command }).cmd;
      expect(approve).toHaveBeenCalledWith("n1", await commandHash(stored));
      expect(await commandHash(stored)).not.toBe(await commandHash(menuDelay));
      expect(helper.calls).toEqual(["command.preview", "approve", "command.apply"]);
      expect(await client.changes(client.id)).toHaveLength(1);
      client.stop();
    });

    it("changes nothing when the person says No at Windows' prompt, and can ask again", async () => {
      let answer: "no" | "yes" = "no";
      const { client, helper } = withCommands({ admin: true, approve: async () => { if (answer === "no") throw APPROVE_DECLINED; } });
      await client.start();
      await client.previewCommand(client.id, menuDelay, false);
      expect(await client.applyCommand(client.id, "n1", meta)).toEqual({ outcome: "declined" });
      expect(helper.calls).not.toContain("command.apply");
      expect(await client.changes(client.id)).toHaveLength(0);
      answer = "yes";
      expect((await client.applyCommand(client.id, "n1", meta)).outcome).toBe("applied");
      expect(await client.changes(client.id)).toHaveLength(1);
      client.stop();
    });

    it("says a plain error when Windows' approval fails for another reason", async () => {
      const { client, helper } = withCommands({ admin: true, approve: async () => { throw "Rig's helper didn't start."; } });
      await client.start();
      await client.previewCommand(client.id, menuDelay, false);
      await expect(client.applyCommand(client.id, "n1", meta)).rejects.toThrow("Rig's helper didn't start.");
      expect(helper.calls).not.toContain("command.apply");
      client.stop();
    });

    it("won't put a change back over something that changed it since, until asked to anyway", async () => {
      const { client, helper } = withCommands({ drifts: ["HKCU\\Control Panel\\Desktop\\MenuShowDelay"] });
      await client.start();
      await client.previewCommand(client.id, menuDelay, false);
      await client.applyCommand(client.id, "n1", meta);
      expect(await client.undoCommand(client.id, "u1")).toEqual({ outcome: "drifted", changed: ["HKCU\\Control Panel\\Desktop\\MenuShowDelay"] });
      expect((await client.changes(client.id))[0].status).toBe("applied");
      expect((await client.undoCommand(client.id, "u1", true)).outcome).toBe("undone");
      expect((await client.changes(client.id))[0].status).toBe("undone");
      expect(helper.seen.filter((c) => c.method === "command.undo").map((c) => c.params)).toEqual([{ id: "u1" }, { id: "u1", force: true }]);
      client.stop();
    });

    it("refuses a tier 3 command after the chat read outside text, before the helper sees it", async () => {
      const { client, helper } = withCommands();
      await client.start();
      const noUndo: Command = { ...menuDelay, undo: null, touches: [{ kind: "other", name: "The menu delay" }] };
      expect(await client.previewCommand(client.id, noUndo, true)).toMatchObject({ outcome: "refused", verdict: { why: "tainted" } });
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
      const { client } = setup({ read, command: helper.command }, cloud);
      await client.start();
      await client.chat(client.id, [{ id: "1", from: "you", text: "What's my menu delay?" }], () => {});
      client.stop();
      expect(read).not.toHaveBeenCalled();
      expect(helper.seen.map((c) => c.params)).toEqual([{ script: "Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay" }, { script: "Get-Service -Name wuauserv" }]);
      expect(asked[0]).toEqual([{ id: "a", ok: true, text: "MenuShowDelay : 400" }, { id: "b", ok: true, text: "MenuShowDelay : 400" }]);
    });
  });
});
