import { describe, expect, it } from "vitest";
import { cardTier, checkStep, lookTakes, screenAppRefusal, screenExamples, stepHash, stepsTitle, type ScreenLook, type Step } from "../src";
import { canonicalStep } from "../src/change";

const lookId = "0123456789abcdef0123456789abcdef";
const look: ScreenLook = { lookId, path: ["NVIDIA Control Panel", "Manage 3D settings", "Low Latency Mode"], value: "Off", options: ["Off", "On", "Ultra"], clean: true, expiresAt: "2030-01-01T00:00:00.000Z" };
const slider: ScreenLook = { lookId: "f".repeat(32), path: ["Settings", "Brightness"], value: "40", range: { min: 0, max: 100 }, clean: true, expiresAt: look.expiresAt };
const screen = (patch: Record<string, unknown> = {}) => ({ kind: "native", op: { name: "screen", lookId, to: "Ultra", does: "Turns on the lowest-latency mode.", ...patch } }) as unknown as Step;
const check = (s: Step, looks: ScreenLook[] = [look, slider], tainted = false) => checkStep(s, { tainted, looks });

describe("which apps a look may open", () => {
  it.each(screenExamples.map((e) => [e.app, e.refused] as const))("%s", (app, refused) => {
    expect(screenAppRefusal(app) !== null).toBe(refused);
  });

  it("says why in plain words, and takes only text", () => {
    expect(screenAppRefusal("C:\\Windows\\regedit.exe")).toBe("Rig doesn't drive Windows' own admin tools.");
    expect(screenAppRefusal("ms-settings:signinoptions")).toMatch(/^Rig only opens Settings at a page on its list/);
    expect(screenAppRefusal(undefined)).not.toBeNull();
    expect(screenAppRefusal("C:\\Program Files\\App\\app.exe\nmore")).not.toBeNull();
  });
});

describe("checking a screen step", () => {
  it("is always tier 3, never admin, whatever the step says of itself", () => {
    expect(check(screen({ tier: 1, admin: true }))).toMatchObject({ status: "allowed", tier: 3, admin: false });
    expect(cardTier([screen()], { tainted: false, looks: [look] })).toBe(3);
  });

  it("is refused when Rig hasn't looked, or the chat doesn't hold the look", () => {
    expect(checkStep(screen())).toMatchObject({ status: "refused", why: "refused" });
    expect(check(screen({ lookId: "a".repeat(32) }))).toMatchObject({ status: "refused", refused: expect.stringContaining("hasn't looked") });
    expect(check(screen(), [])).toMatchObject({ status: "refused" });
  });

  it("is refused when the value isn't one the control offered", () => {
    expect(check(screen({ to: "Maximum" }))).toMatchObject({ status: "refused", refused: expect.stringContaining("offered") });
    expect(check(screen({ to: "ultra" }))).toMatchObject({ status: "refused" });
    expect(check(screen({ lookId: slider.lookId, to: "75" }))).toMatchObject({ status: "allowed", tier: 3 });
    expect(check(screen({ lookId: slider.lookId, to: "101" }))).toMatchObject({ status: "refused" });
    expect(check(screen({ lookId: slider.lookId, to: "1e2" }))).toMatchObject({ status: "refused" });
    expect(lookTakes(slider, "0")).toBe(true);
    expect(lookTakes(slider, "-1")).toBe(false);
  });

  it("is refused as tainted when the chat read outside text, or the look itself wasn't clean", () => {
    expect(check(screen(), [look], true)).toMatchObject({ status: "refused", why: "tainted" });
    expect(check(screen(), [{ ...look, clean: false }])).toMatchObject({ status: "refused", why: "tainted" });
    expect(cardTier([screen()], { tainted: false, looks: [{ ...look, clean: false }] })).toBe("refused");
  });

  it("holds no hops, app or current value: anything else sent is dropped", () => {
    const sent = screen({ hops: [{ name: "Restore" }], app: "C:\\Windows\\regedit.exe", from: "Off" });
    expect(canonicalStep(sent as Extract<Step, { kind: "native" }>)).toEqual({ kind: "native", op: { name: "screen", lookId, to: "Ultra", does: "Turns on the lowest-latency mode." } });
    expect(check(screen({ lookId: "nope" }))).toMatchObject({ status: "refused" });
    expect(check(screen({ to: "two\nlines" }))).toMatchObject({ status: "refused" });
    expect(check(screen({ to: "caf\u00e9" }))).toMatchObject({ status: "refused" });
    expect(check(screen({ does: " " }))).toMatchObject({ status: "refused" });
  });

  it("has the fingerprint the helper works out, and Claude's sentence as its title", async () => {
    // helper/RigHelper/ScreenSelfTest.cs holds the same value.
    expect(await stepHash(screen())).toBe("11c8f16a31f39d8059a97c5e1fb5422f5f24bc917f7f4a05bf969ef4e0e04e3d");
    expect(stepsTitle([screen()])).toBe("Turns on the lowest-latency mode");
  });
});
