// display.appGpu, Windows' graphics preference for one app: what may be proposed, what the card shows, and what undo
// puts back. On a laptop with two graphics chips it moves a game off the built-in chip.

import { describe, expect, it } from "vitest";
import { catalog, checkStep, cleanProcesses, describeCall, fixSteps, LocalClient, MemoryStore, titleFor, validateCall, type ActionCall } from "../src";
import { SimulatedLink, fixtures } from "../src/demo";

const gpuCall = (over: Record<string, unknown> = {}) => ({ kind: "display.appGpu", app: "bg3.exe", gpu: "high", ...over }) as ActionCall;
const PATH = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Baldurs Gate 3\\bin\\bg3.exe";

describe("display.appGpu", () => {
  it("takes a program's file name and a preference, at tier 1, and is in the catalog the chat reads", () => {
    expect(validateCall(gpuCall())).toBeNull();
    expect(validateCall(gpuCall({ app: "Baldur's Gate 3.exe", gpu: "saving" }))).toBeNull();
    expect(validateCall(gpuCall({ gpu: "none", path: PATH }))).toBeNull();
    expect(checkStep(fixSteps([gpuCall()])[0])).toMatchObject({ status: "allowed", tier: 1, admin: false });
    expect(catalog.find((a) => a.kind === "display.appGpu")?.schema).toMatchObject({ required: ["app", "gpu"] });
  });

  it("refuses a folder, another kind of file, an odd preference or a path that isn't the program's own", () => {
    expect(validateCall(gpuCall({ app: "C:\\Games\\bg3.exe" }))).toMatch(/file name/);
    expect(validateCall(gpuCall({ app: "bg3.bat" }))).toMatch(/file name/);
    expect(validateCall(gpuCall({ app: "" }))).toMatch(/file name/);
    expect(validateCall(gpuCall({ gpu: "turbo" }))).toMatch(/auto, saving or high/);
    expect(validateCall(gpuCall({ path: "C:\\Games\\other.exe" }))).toMatch(/full path/);
    expect(validateCall(gpuCall({ path: "C:\\Games\\..\\bg3.exe" }))).toMatch(/full path/);
    expect(validateCall(gpuCall({ path: "bg3.exe" }))).toMatch(/full path/);
    expect(validateCall(gpuCall({ path: "C:\\Games\\*\\bg3.exe" }))).toMatch(/full path/);
    expect(validateCall(gpuCall({ path: 7 }))).toMatch(/full path/);
  });

  it("shows the preference in Windows' own words, and when it takes effect", () => {
    const f = structuredClone(fixtures.comet.facts);
    expect(describeCall(gpuCall(), f)).toEqual(["Graphics for bg3.exe, from its next start", "Let Windows decide", "High performance"]);
    f.gpuPreferences = { "bg3.exe": "saving" };
    expect(describeCall(gpuCall({ app: "BG3.exe" }), f)).toEqual(["Graphics for BG3.exe, from its next start", "Power saving", "High performance"]);
    // An older helper doesn't read the preferences.
    expect(describeCall(gpuCall(), fixtures.atlas.facts)[1]).toBe("Unknown");
    expect(titleFor([gpuCall()])).toBe("Set bg3.exe to use the graphics card");
    expect(titleFor([gpuCall({ gpu: "none" })])).toBe("Let Windows pick the graphics for bg3.exe");
  });

  it("previews, sets it, and undo takes the preference away again at the program's own path", async () => {
    let t = new Date("2026-11-17T20:00:00").getTime();
    const sim = new SimulatedLink(fixtures.comet.inv, fixtures.comet.facts, { now: () => t });
    const applied: ActionCall[] = [];
    const link = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: async (c: ActionCall) => { applied.push(structuredClone(c)); return sim.apply(c); } };
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => (t += 1000) });
    await client.start();
    const steps = fixSteps([gpuCall()]);
    expect(await client.preview(client.id, steps)).toEqual([["Graphics for bg3.exe, from its next start", "Let Windows decide", "High performance"]]);

    const change = await client.apply(client.id, steps, { by: "you" });
    expect(change).toMatchObject({ tier: 1, status: "applied", title: "Set bg3.exe to use the graphics card" });
    expect((await sim.facts()).gpuPreferences).toEqual({ "steam.exe": "saving", "bg3.exe": "high" });
    expect(await client.preview(client.id, steps)).toEqual([["Graphics for bg3.exe, from its next start", "High performance", "High performance"]]);

    await client.undo(client.id, change.id);
    expect(applied[1]).toEqual({ kind: "display.appGpu", app: "bg3.exe", path: PATH, gpu: "none" });
    expect((await sim.facts()).gpuPreferences).toEqual({ "steam.exe": "saving" });
    client.stop();
  });

  it("refuses an undo call whose path isn't the program's own, and changes nothing", async () => {
    const sim = new SimulatedLink(fixtures.comet.inv, fixtures.comet.facts);
    await expect(sim.apply(gpuCall({ gpu: "none", path: "C:\\Windows\\System32\\cmd.exe" }))).rejects.toThrow(/full path/);
    expect((await sim.facts()).gpuPreferences).toEqual({ "steam.exe": "saving" });
  });
});

describe("the busiest apps on a laptop with two graphics chips", () => {
  const card = "NVIDIA GeForce RTX 4060 Laptop GPU", built = "AMD Radeon(TM) 780M Graphics";

  it("keeps each app's share of the built-in chip beside its share of the card, and reads the same cleaned again", () => {
    const raw = [
      { name: "bg3.exe", cpu: 30, memMb: 9000, gpu: 85, gpus: { [built]: 85 } },
      { name: "cs2.exe", cpu: 20, memMb: 4000, gpu: 90, gpus: { [card]: 90, [built]: 4 } },
    ];
    const once = cleanProcesses(raw, Infinity, card);
    expect(once).toEqual([
      { name: "bg3.exe", cpu: 30, memMb: 9000, builtIn: 85 },
      { name: "cs2.exe", cpu: 20, memMb: 4000, gpu: 90, builtIn: 4 },
    ]);
    expect(cleanProcesses(once, Infinity, card)).toEqual(once);
    // With one graphics chip there's no built-in share to tell apart.
    expect(cleanProcesses(raw, Infinity)).toEqual([{ name: "bg3.exe", cpu: 30, memMb: 9000, gpu: 85 }, { name: "cs2.exe", cpu: 20, memMb: 4000, gpu: 90 }]);
  });
});
