// Graphics driver settings: the table Rig offers, the check on a {gpu} step, and the gpu read. The helper embeds the
// same table (rules/gpu.json) and checks again; its self-test holds the fingerprint below.
import { describe, expect, it } from "vitest";
import { canonicalStep, checkRead, checkStep, readTaints, stepHash, stepsTitle, GPU_SETTINGS, type HelperStep, type PcReadSpec, type Step } from "../src";
import table from "../src/rules/gpu.json";

const gpu = (op: Record<string, unknown>) => ({ kind: "native", op: { name: "gpu", vendor: "nvidia", does: "Turns vertical sync off.", ...op } }) as unknown as Step;
const refused = (step: Step) => {
  const v = checkStep(step);
  if (v.status !== "refused") throw new Error(`allowed: ${JSON.stringify(step)}`);
  return v.refused;
};
const hex = /^0x[0-9A-F]{8}$/;

describe("the graphics settings table", () => {
  it("offers about fifteen settings, each with plain words and NVIDIA's own ids, every write tier 1", () => {
    const settings = Object.entries(GPU_SETTINGS);
    expect(settings.length).toBeGreaterThanOrEqual(15);
    const defaults = table.nvidia.defaults as Record<string, unknown>;
    for (const [key, s] of settings) {
      expect(s.name, key).toMatch(/^[A-Z]/);
      expect(s.says.length, key).toBeGreaterThan(20);
      expect(s.tier, key).toBe(1);
      for (const [v, value] of Object.entries(s.values)) {
        expect(value.says, `${key}.${v}`).toBeTruthy();
        for (const [id, n] of Object.entries(value.set)) {
          expect(id, `${key}.${v}`).toMatch(hex);
          // Every id Rig sets has the driver's own default, so a read can tell what holds when nothing sets it.
          expect(defaults[id], `${key}.${v} ${id}`).toBeDefined();
          expect(typeof n === "number" ? Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff : /^0x[0-9A-F]{1,8}$/.test(n), `${key}.${v} ${id}`).toBe(true);
        }
      }
      // No two choices set the same values, so a read can't take one for another.
      const sets = Object.values(s.values).map((v) => JSON.stringify(Object.entries(v.set).sort()));
      expect(new Set(sets).size, key).toBe(sets.length);
    }
  });
});

describe("a gpu step", () => {
  it("is tier 1, never admin, from a setting and value in the table", () => {
    expect(checkStep(gpu({ setting: "vsync", value: "off", app: "Game.EXE" }))).toMatchObject({ status: "allowed", tier: 1, admin: false, commands: [] });
    expect(checkStep(gpu({ setting: "maxFrameRate", value: "141" }))).toMatchObject({ status: "allowed", tier: 1 });
    expect(checkStep(gpu({ setting: "shaderCache", value: "10gb" }))).toMatchObject({ status: "allowed", tier: 1 });
  });

  it("refuses anything that isn't in the table, in plain words", () => {
    expect(refused(gpu({ setting: "0x00A879CF", value: "off" }))).toContain("Rig doesn't change that graphics setting. It changes: lowLatency,");
    expect(refused(gpu({ setting: "toString", value: "off" }))).toContain("doesn't change that graphics setting");
    expect(refused(gpu({ setting: "vsync", value: "0x08416747" }))).toBe("Vertical sync takes one of: app, off, on, adaptive, fast.");
    expect(refused(gpu({ setting: "maxFrameRate", value: "5" }))).toBe("Max frame rate takes one of: off, or a whole number from 20 to 1000.");
    expect(refused(gpu({ setting: "maxFrameRate", value: "060" }))).toContain("takes one of");
    expect(refused(gpu({ setting: "shaderCache", value: "off", app: "game.exe" }))).toBe("Shader cache size is one setting for the whole PC, not for one game. Leave app out.");
    expect(refused(gpu({ setting: "vsync", value: "off", app: "C:\\Games\\game.exe" }))).toContain("program file name");
    expect(refused(gpu({ setting: "vsync", value: "off", app: "game" }))).toContain("program file name");
    expect(refused(gpu({ setting: "vsync", value: "off", does: " " }))).toBe("does must be one plain sentence.");
  });

  it("won't change Windows' own programs, such as the desktop", () => {
    expect(refused(gpu({ setting: "maxFrameRate", value: "20", app: "DWM.exe" }))).toBe("That is one of Windows' own programs, not a game, so Rig doesn't change its graphics settings.");
    expect(refused(gpu({ setting: "vsync", value: "off", app: "explorer.exe" }))).toContain("Windows' own programs");
  });

  it("can't change AMD or Intel settings yet", () => {
    expect(refused(gpu({ vendor: "amd", setting: "vsync", value: "off" }))).toBe("Rig can only change NVIDIA's graphics settings for now.");
    expect(refused(gpu({ vendor: "intel", setting: "vsync", value: "off" }))).toBe("Rig can only change NVIDIA's graphics settings for now.");
  });

  it("is fingerprinted as Rig keeps it: the app in lower case, a number as text, nothing it doesn't know", async () => {
    const sent = canonicalStep({ kind: "native", op: { name: "gpu", vendor: "nvidia", app: "Game.exe", setting: "maxFrameRate", value: 141, does: "Caps the frame rate at 141.", admin: true } } as unknown as HelperStep);
    expect(sent).toEqual({ kind: "native", op: { name: "gpu", vendor: "nvidia", app: "game.exe", setting: "maxFrameRate", value: "141", does: "Caps the frame rate at 141." } });
    // The helper's self-test holds this fingerprint for the same op as it sent (Gpu.cs), so both sides keep it the same way.
    expect(await stepHash(sent as Step)).toBe("24df9e27fb32ca00223a69c7f96c1c566caeb81ff39f04e219fdb83eaf220a54");
  });

  it("has a title for the changes log", () => {
    expect(stepsTitle([gpu({ setting: "vsync", value: "off", app: "game.exe" })])).toBe("Set Vertical sync to Off for game.exe");
    expect(stepsTitle([gpu({ setting: "powerMode", value: "max" })])).toBe("Set Power management mode to Prefer maximum performance for every game");
    expect(stepsTitle([gpu({ setting: "maxFrameRate", value: "60" })])).toBe("Set Max frame rate to 60 frames a second for every game");
  });
});

describe("a gpu read", () => {
  const read = (raw: Record<string, unknown>) => checkRead({ kind: "gpu", ...raw });

  it("reads any of the three makers' settings, for a game or the whole PC, without tainting the chat", () => {
    expect(read({ vendor: "nvidia", app: "Game.exe", settings: ["vsync", "lowLatency"], extra: 1 })).toEqual({ kind: "gpu", vendor: "nvidia", app: "game.exe", settings: ["vsync", "lowLatency"] });
    expect(read({ vendor: "amd" })).toEqual({ kind: "gpu", vendor: "amd" });
    expect(readTaints(read({ vendor: "intel" }) as PcReadSpec)).toBe(false);
  });

  it("refuses a maker, a game or a setting it doesn't know", () => {
    expect(read({ vendor: "matrox" })).toBe("A gpu read needs vendor: nvidia, amd or intel.");
    expect(read({ vendor: "nvidia", app: "..\\x.exe" })).toContain("program file name");
    expect(read({ vendor: "nvidia", settings: ["0x00A879CF"] })).toContain("keys from Rig's list");
  });
});
