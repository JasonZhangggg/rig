import { describe, expect, it, vi } from "vitest";
import { LocalClient, MemoryStore, type HelperLink } from "../src";
import { SimulatedLink, fixtures } from "../src/demo";
import { canonicalNative, cardTier, checkStep, stepHash, type Allowed, type HelperStep, type StepRpc } from "../src/change";
import { DEFAULT_REVERT_AFTER, PROTECTIONS, REVERT_AFTER, type RevertsReply } from "../src/protection";

const lower = (op: Record<string, unknown> = {}) => ({ kind: "native", op: { name: "protection", id: "firewall-public", revertAfter: 15, ...op } }) as unknown as HelperStep;
const keep = { kind: "native", op: { name: "protectionKeep", id: "firewall-public" } } as unknown as HelperStep;

describe("turning a protection off for a while", () => {
  it("is always tier 3 and needs Windows' prompt, whichever row and time", () => {
    for (const row of PROTECTIONS) for (const revertAfter of REVERT_AFTER) {
      expect(checkStep(lower({ id: row.id, revertAfter }))).toMatchObject({ status: "allowed", tier: 3, admin: true });
    }
    expect(cardTier([lower()])).toBe(3);
  });

  it("takes only a row of the list and a time from the list, and an hour when no time is given", () => {
    expect(canonicalNative({ name: "protection", id: "firewall-public" })).toEqual({ name: "protection", id: "firewall-public", revertAfter: DEFAULT_REVERT_AFTER });
    expect(canonicalNative({ name: "protection", id: "firewall-public", revertAfter: 15, script: "Set-MpPreference", undo: "x" })).toEqual({ name: "protection", id: "firewall-public", revertAfter: 15 });
    expect(checkStep(lower({ revertAfter: 600 }))).toMatchObject({ status: "refused", refused: expect.stringContaining("15 minutes, 1 hour or 4 hours") });
    expect(checkStep(lower({ revertAfter: 0 }))).toMatchObject({ status: "refused" });
    expect(checkStep(lower({ revertAfter: "15" }))).toMatchObject({ status: "refused" });
    expect(checkStep(lower({ id: "bitlocker" }))).toMatchObject({ status: "refused", refused: expect.stringContaining("Windows Firewall on public networks") });
  });

  it("never lowers User Account Control, as a protection or as a command", () => {
    expect(checkStep(lower({ id: "uac" }))).toMatchObject({ status: "refused", why: "never", refused: expect.stringContaining("User Account Control") });
    const key = "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
    for (const value of ["EnableLUA", "ConsentPromptBehaviorAdmin", "PromptOnSecureDesktop"]) {
      const cmd = { does: "Turns off the prompt.", read: `Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name ${value}`, run: `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name ${value} -Value 0`, touches: [{ kind: "registry" as const, key, value }] };
      expect(checkStep({ kind: "command", cmd })).toMatchObject({ status: "refused", why: "never" });
    }
  });

  it("keeps a protection off only as the person's own choice in the app, never as a step Claude proposes", () => {
    expect(checkStep(keep)).toMatchObject({ status: "refused", refused: expect.stringContaining("Only you can choose") });
    expect(checkStep(keep, { tainted: false })).toMatchObject({ status: "refused" });
    expect(checkStep(keep, { tainted: false, byPerson: true })).toMatchObject({ status: "allowed", tier: 3, admin: true });
    expect(cardTier([keep])).toBe("refused");
  });
});

describe("a protection that is off for now, in the Rig app", () => {
  const dueAt = "2026-11-17T20:15:00.000Z";
  function app() {
    const calls: string[] = [];
    const state: { reverts: RevertsReply; nonce: number; undo: number } = { reverts: { readable: true, waiting: [], ended: [] }, nonce: 0, undo: 0 };
    const helper = async <K extends keyof StepRpc>(method: K, params: StepRpc[K]["params"]): Promise<StepRpc[K]["reply"]> => {
      if (method === "firmware.after") return { found: [] } as StepRpc[K]["reply"];
      calls.push(method);
      const step = (params as { step?: HelperStep }).step;
      const kept = step?.kind === "native" && step.op.name === "protectionKeep";
      const reply = async (): Promise<StepRpc[keyof StepRpc]["reply"]> => {
        switch (method) {
          case "step.preview": return { outcome: "ready", nonce: `n${++state.nonce}`, expiresAt: "2026-11-17T20:10:00.000Z", verdict: checkStep(step!, { tainted: false, byPerson: kept }) as Allowed, read: kept ? "Off for now" : "On", touches: [], hash: await stepHash(step!) };
          case "step.apply": return { outcome: "applied", result: { before: "On", after: "Off", output: "", alsoChanged: [], touches: [], ...(state.nonce === 1 ? { revert: { id: "r1", dueAt } } : {}) }, undo: { kind: "native", id: `u${++state.undo}`, outside: [], fingerprint: "f" } };
          case "step.undo": return { outcome: "undone", printed: "On", left: [] };
          default: return state.reverts;
        }
      };
      return (await reply()) as StepRpc[K]["reply"];
    };
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => 0 });
    const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), step: helper };
    const approve = vi.fn(async (_nonce: string, _hash: string) => { calls.push("approve"); });
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => new Date("2026-11-17T20:00:00Z").getTime(), approveStep: approve });
    const turnOff = async () => {
      await client.start();
      const seen = await client.previewStep(client.id, lower(), false);
      if (seen.outcome !== "ready") throw new Error("no card");
      await client.applyStep(client.id, seen.nonce, { by: "rig" });
      state.reverts = { readable: true, waiting: [{ id: "r1", row: "firewall-public", dueAt }], ended: [] };
    };
    return { client, calls, state, approve, turnOff };
  }

  it("asks Windows before turning it off, and shows it as off with the time it comes back on", async () => {
    const { client, calls, turnOff } = app();
    await turnOff();
    expect(calls).toEqual(["step.preview", "approve", "step.apply"]);
    const [change] = await client.changes(client.id);
    expect(change).toMatchObject({ title: "Turned off Windows Firewall on public networks for 15 minutes", tier: 3, status: "applied", diff: [["Windows Firewall on public networks", "On", "Off"]] });
    expect(await client.reverts(client.id)).toEqual([{ changeId: change.id, undoId: "u1", row: PROTECTIONS.find((r) => r.id === "firewall-public"), dueAt, kept: false, checked: true }]);
    client.stop();
  });

  it("files the change as back on once Rig's service has turned it on, and says how", async () => {
    const { client, state, turnOff } = app();
    await turnOff();
    state.reverts = { readable: true, waiting: [], ended: [{ id: "r1", row: "firewall-public", how: "raised", why: "due", at: dueAt }] };
    expect(await client.reverts(client.id)).toEqual([]);
    const [change] = await client.changes(client.id);
    expect(change.status).toBe("undone");
    expect(change.result).toMatch(/^Rig turned Windows Firewall on public networks back on at .+\.$/);
    client.stop();
  });

  it("says so when it was already back on and Rig left it alone", async () => {
    const { client, state, turnOff } = app();
    await turnOff();
    state.reverts = { readable: true, waiting: [], ended: [{ id: "r1", row: "firewall-public", how: "left", why: "due", at: dueAt }] };
    await client.reverts(client.id);
    expect((await client.changes(client.id))[0]).toMatchObject({ status: "undone", result: expect.stringContaining("was already back on") });
    client.stop();
  });

  it("turns it back on now through the change's own undo", async () => {
    const { client, calls, turnOff } = app();
    await turnOff();
    expect((await client.undoStep(client.id, "u1")).outcome).toBe("undone");
    expect(calls.at(-1)).toBe("step.undo");
    expect((await client.changes(client.id))[0].status).toBe("undone");
    expect(await client.reverts(client.id)).toEqual([]);
    client.stop();
  });

  it("keeps it off only through a second step of the person's own, approved at Windows' prompt and logged", async () => {
    const { client, calls, state, approve, turnOff } = app();
    await turnOff();
    const [first] = await client.changes(client.id);
    calls.length = 0;
    const reply = await client.keepOff(client.id, first.id);
    expect(reply.outcome).toBe("applied");
    expect(calls).toEqual(["protection.reverts", "step.preview", "approve", "step.apply", "protection.reverts"]);
    expect(approve).toHaveBeenCalledTimes(2);
    state.reverts = { readable: true, waiting: [], ended: [{ id: "r1", row: "firewall-public", how: "kept", why: "you", at: dueAt }] };
    expect(await client.reverts(client.id)).toMatchObject([{ changeId: first.id, kept: true }]);
    const all = await client.changes(client.id);
    const kept = all.find((c) => c.id !== first.id), lowered = all.find((c) => c.id === first.id)!;
    expect(all).toHaveLength(2);
    expect(kept).toMatchObject({ title: "Kept Windows Firewall on public networks off", by: "you", tier: 3, status: "applied" });
    expect(lowered.status).toBe("applied");
    expect(await client.keepOff(client.id, first.id)).toEqual({ outcome: "expired" });
    client.stop();
  });

  it("doesn't keep it off when Windows' prompt is answered No", async () => {
    const { client, approve, turnOff } = app();
    await turnOff();
    approve.mockRejectedValueOnce(new Error("declined"));
    const [first] = await client.changes(client.id);
    const reply = await client.keepOff(client.id, first.id).catch((e: Error) => e.message);
    expect(reply === "declined" || (typeof reply === "object" && reply.outcome === "declined")).toBe(true);
    expect(await client.reverts(client.id)).toMatchObject([{ kept: false }]);
    client.stop();
  });

  it("won't preview a keep-off step that didn't come from the person's own button", async () => {
    const { client, calls, turnOff } = app();
    await turnOff();
    calls.length = 0;
    expect(await client.previewStep(client.id, keep, false)).toMatchObject({ outcome: "refused" });
    expect(calls).toEqual([]);
    client.stop();
  });
});
