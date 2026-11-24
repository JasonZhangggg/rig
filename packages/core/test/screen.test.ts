import { describe, expect, it } from "vitest";
import { cardTier, checkRead, checkStep, lookText, lookTakes, nativeRows, screenAppRefusal, screenExamples, screenLookReply, stepHash, stepsTitle, type NativeOp, type ScreenLook, type Step } from "../src";
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

describe("asking for a look", () => {
  it("names the app by Rig's name or a Settings page on the list, never a program's path", () => {
    expect(checkRead({ kind: "screen", app: "nvidia control panel", goal: ["Manage 3D settings", "Low Latency Mode"] })).toEqual({ kind: "screen", app: "NVIDIA Control Panel", goal: ["Manage 3D settings", "Low Latency Mode"] });
    expect(checkRead({ kind: "screen", app: "ms-settings:display", goal: ["Brightness"] })).toMatchObject({ app: "ms-settings:display" });
    expect(checkRead({ kind: "screen", app: "C:\\Program Files\\MSI\\MSI Center\\MSI Center.exe", goal: ["Fan"] })).toMatch(/^Rig looks only in an app on its list/);
    expect(checkRead({ kind: "screen", app: "ms-settings:signinoptions", goal: ["PIN"] })).toEqual(expect.any(String));
  });

  it("takes one to eight short plain names, and none Rig never presses", () => {
    const at = (goal: unknown) => checkRead({ kind: "screen", app: "NVIDIA Control Panel", goal });
    expect(at([])).toMatch(/one to eight controls/);
    expect(at(Array(9).fill("Tab"))).toMatch(/one to eight controls/);
    expect(at(["two\nlines"])).toMatch(/one to eight controls/);
    expect(at(["x".repeat(81)])).toMatch(/one to eight controls/);
    expect(at(["Restore Defaults"])).toBe("Rig doesn't open, set or press anything in an app with a name like that.");
  });
});

describe("the helper's answer to a look", () => {
  const raw = { lookId, path: look.path, value: "Off", options: ["Off", "On", "Ultra"], clean: true, expiresAt: look.expiresAt };

  it("keeps a look's own fields and nothing else", () => {
    expect(screenLookReply({ ...raw, hops: [{ name: "Restore" }], image: "C:\\x.exe" })).toEqual(look);
    expect(screenLookReply({ lookId: slider.lookId, path: slider.path, value: "40", range: { min: 0, max: 100 }, clean: true, expiresAt: look.expiresAt })).toEqual(slider);
  });

  it("counts a look as clean only when the helper says true", () => {
    expect(screenLookReply({ ...raw, clean: "yes" })).toMatchObject({ clean: false });
    expect(screenLookReply({ ...raw, clean: undefined })).toMatchObject({ clean: false });
    expect(screenLookReply({ refused: "Low Latency Mode isn't there.", shows: ["Program Settings"] })).toEqual({ refused: "Low Latency Mode isn't there.", shows: ["Program Settings"], clean: false });
  });

  it("isn't a look when a part is missing, too long, more than one line, or not plain", () => {
    for (const bad of [
      null, "look", { ...raw, lookId: "nope" }, { ...raw, path: ["NVIDIA Control Panel"] }, { ...raw, value: "x".repeat(81) }, { ...raw, value: "two\nlines" },
      { ...raw, options: ["caf\u00e9"] }, { ...raw, options: [] }, { ...raw, options: Array(101).fill("x") }, { ...raw, options: undefined },
      { ...raw, options: undefined, range: { min: 5, max: 1 } }, { ...raw, range: { min: 0, max: 1 } }, { ...raw, expiresAt: "soon" }, { refused: "" }, { refused: "No.", shows: ["a\nb"] },
    ]) expect(screenLookReply(bad)).toBeNull();
  });

  it("reads as the app, the path, the value now and what it takes", () => {
    expect(lookText(look)).toBe(`App: NVIDIA Control Panel\nPath: Manage 3D settings › Low Latency Mode\nNow: Off\nTakes one of: Off | On | Ultra\nlookId: ${lookId}`);
    expect(lookText(slider)).toContain("Takes a number from 0 to 100");
    expect(lookText({ refused: "It isn't open.", shows: ["Home"], clean: true })).toBe("Rig stopped: It isn't open.\nIt saw: Home");
  });

  it("logs the control's name and its value before and after from the helper's one-line read", () => {
    const op: NativeOp = { name: "screen", lookId, to: "Ultra", does: "Turns on the lowest-latency mode." };
    expect(nativeRows(op, "Low Latency Mode: Off", "Low Latency Mode: Ultra")).toEqual([["Low Latency Mode", "Off", "Ultra"]]);
    expect(nativeRows(op)).toEqual([["Setting", "As it is now", "Ultra"]]);
  });
});
