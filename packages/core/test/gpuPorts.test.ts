import { describe, expect, it } from "vitest";
import { buildPC, cardUse, gpuModels, gpuPick, gpuPowerOptions, gpus, plugPinout, resolveBuild, type DisplayLink, type Inventory } from "../src";
import atlas from "../src/demo/fixtures/atlas.inventory.json";

const NAME = "NVIDIA GeForce RTX 4070 SUPER";
// MSI's Ventus 2X: one HDMI and three DisplayPort outputs.
const typical = resolveBuild({ gpu: { name: NAME }, picks: { gpu: "msi-ventus2x-4070s-oc" } }).gpu!.ports!;
const strix = resolveBuild({ gpu: { name: "NVIDIA GeForce RTX 4070 SUPER" }, picks: { gpu: "asus-strix-4070s-oc" } }).gpu!.ports!;
const screen = (name: string, more: Partial<DisplayLink> = {}): DisplayLink => ({ name, width: 2560, height: 1440, refreshHz: 144, connection: "displayport", onCard: true, ...more });
const group = (u: ReturnType<typeof cardUse>, kind: string) => u.groups.find((g) => g.kind === kind)!;

describe("the graphics card's plugs", () => {
  it("lists a known card's own outputs and plugs, and none for a card it can't name", () => {
    expect(strix.exact).toBe(true);
    expect(strix.outputs.map((o) => o.label)).toEqual(["HDMI 1", "HDMI 2", "DisplayPort 1", "DisplayPort 2", "DisplayPort 3"]);
    expect(strix.power.map((p) => p.label)).toEqual(["16-pin power"]);
    // The chip alone, or a maker with more than one card of the chip, isn't the card: no outputs or plugs.
    expect(resolveBuild({ gpu: { name: NAME } }).gpu!.ports).toBeUndefined();
    expect(resolveBuild({ gpu: { name: "AMD Radeon RX 6700 XT", subsysVendor: "1DA2" } }).gpu!.ports).toBeUndefined();
    expect(resolveBuild({ gpu: { name: NAME, subsysVendor: "1462" } }).gpu!.ports).toBeUndefined();
  });

  it("names the card from Windows' subsystem ids when Rig knows them", () => {
    gpus["test-card"] = { ...gpus["msi-ventus2x-4070s-oc"], model: "Test card", subsys: ["5133"] };
    try {
      const card = resolveBuild({ gpu: { name: NAME, subsysVendor: "1462", subsysId: "5133" } }).gpu!;
      expect([card.model, card.source, card.ports?.power.map((p) => p.kind)]).toEqual(["Test card", "detected", ["16-pin"]]);
    } finally { delete gpus["test-card"]; }
  });

  it("lists the plug layouts an RX 6700 XT can have, narrowed by its maker", () => {
    const any = gpuPowerOptions({ name: "AMD Radeon RX 6700 XT" });
    expect(any.layouts.map((l) => l.power.join(" + "))).toEqual(["8-pin + 6-pin", "8-pin + 8-pin"]);
    expect(any.layouts[0].models).toContain("AMD's own");
    const xfx = gpuPowerOptions({ name: "AMD Radeon RX 6700 XT", subsysVendor: "1682" });
    expect([xfx.maker, xfx.layouts]).toEqual(["XFX", [{ power: ["8-pin", "8-pin"], models: ["XFX Speedster SWFT 309", "XFX Speedster QICK 319"] }]]);
    expect(gpuPowerOptions({ name: "AMD Radeon RX 6700 XT", subsysVendor: "1043" }).layouts.length).toBe(2);
    // XFX has two maker ids; both narrow the list to its cards.
    expect(gpuPowerOptions({ name: "AMD Radeon RX 6700 XT", subsysVendor: "1EAE" }).layouts).toEqual(xfx.layouts);
  });

  const RX = "AMD Radeon RX 6700 XT";
  it("names an RX 6700 XT from Windows' subsystem ids, with its power plugs and no outputs it hasn't checked", () => {
    const qick = resolveBuild({ gpu: { name: RX, subsysVendor: "1EAE", subsysId: "6601" } }).gpu!;
    expect([qick.model, qick.source, qick.ports?.power.map((p) => p.kind), qick.ports?.outputs, qick.ports?.from])
      .toEqual(["XFX Speedster QICK 319 RX 6700 XT", "detected", ["8-pin", "8-pin"], [], "From XFX's spec page"]);
    // Rig can name the Pulse but hasn't checked its plugs, so it shows none.
    const pulse = resolveBuild({ gpu: { name: RX, subsysVendor: "1da2", subsysId: "445e" } }).gpu!;
    expect([pulse.model, pulse.source, pulse.ports?.power]).toEqual(["Sapphire Pulse RX 6700 XT", "detected", []]);
    // An id Rig doesn't know isn't a guess at a model.
    expect(resolveBuild({ gpu: { name: RX, subsysVendor: "1eae", subsysId: "9999" } }).gpu!.ports).toBeUndefined();
  });

  it("offers the models of the card's chip and maker to pick from, and takes the pick as the card", () => {
    expect(gpuModels({ name: RX, subsysVendor: "1462" }).map((m) => [m.name, m.power?.join(" + ")]))
      .toEqual([["MSI Gaming X RX 6700 XT", "8-pin + 8-pin"], ["MSI Mech 2X RX 6700 XT", "8-pin + 8-pin"]]);
    expect(gpuModels({ name: RX })).toHaveLength(16);
    expect(gpuModels({ name: "NVIDIA GeForce RTX 4060" })).toEqual([]);
    const picked = resolveBuild({ gpu: { name: RX }, picks: { gpu: "rx6700xt-asus-dual" } }).gpu!;
    expect([picked.model, picked.source, picked.ports?.power.map((p) => p.kind)]).toEqual(["ASUS Dual RX 6700 XT", "picked", ["8-pin", "6-pin"]]);
    // A pick for another card (it was swapped), or "I'm not sure", leaves the card unnamed.
    expect(resolveBuild({ gpu: { name: NAME }, picks: { gpu: "rx6700xt-asus-dual" } }).gpu!.ports).toBeUndefined();
    expect(resolveBuild({ gpu: { name: RX }, picks: { gpu: "unsure:RX 6700 XT" } }).gpu!.ports).toBeUndefined();
    expect([gpuPick({ name: RX }, "unsure:RX 6700 XT"), gpuPick({ name: NAME }, "unsure:RX 6700 XT"), gpuPick({ name: RX }, "rx6700xt-amd")])
      .toEqual(["unsure", undefined, "rx6700xt-amd"]);
  });

  it("lists each screen and its kind of plug when it doesn't know the card's outputs", () => {
    const want = { groups: [], elsewhere: [], screens: [{ name: "XV275U F5", detail: "2560 × 1440 at 320 Hz", plug: "an HDMI" }] };
    const xv = [screen("XV275U F5", { connection: "hdmi", refreshHz: 320 })];
    expect(cardUse(undefined, xv)).toEqual(want);
    expect(cardUse(resolveBuild({ gpu: { name: "AMD Radeon RX 6700 XT" }, picks: { gpu: "rx6700xt-amd" } }).gpu!.ports, xv)).toEqual(want);
  });

  it("puts a screen on the card's one HDMI output for certain", () => {
    const u = cardUse(typical, [screen("Dell P2422H", { connection: "hdmi" })]);
    expect(group(u, "hdmi").outputs[0]).toMatchObject({ state: "used", screen: "Dell P2422H" });
    expect(group(u, "dp").outputs.every((o) => o.state === "free")).toBe(true);
  });

  it("says one of the DisplayPort outputs is in use without guessing which", () => {
    const g = group(cardUse(typical, [screen("LG 27GP850")]), "dp");
    expect(g.outputs.map((o) => o.state)).toEqual(["some", "some", "some"]);
    expect(g.outputs.some((o) => o.screen)).toBe(false);
    expect(g.screens).toEqual(["LG 27GP850, 2560 × 1440 at 144 Hz"]);
    expect(g.note).toBe("1 of 3 in use. Windows doesn't say which ones.");
  });

  it("flags a screen plugged into the motherboard instead of the card", () => {
    const u = cardUse(typical, [screen("LG 27GP850", { onCard: false })]);
    expect(u.elsewhere).toEqual([{ name: "LG 27GP850", note: expect.stringMatching(/^On the motherboard's own video out/) }]);
    expect(group(u, "dp").outputs.every((o) => o.state === "free")).toBe(true);
  });

  it("says so when Windows didn't say how screens connect", () => {
    const u = cardUse(typical, [screen("LG 27GP850", { connection: undefined, onCard: undefined })]);
    expect(u.unknown).toBe("1 screen connected. Windows didn't say which kind of plug it uses.");
    expect(u.groups.flatMap((g) => g.outputs).every((o) => o.state === "unknown")).toBe(true);
  });

  it("notes a screen on a kind of plug the card's list doesn't have", () => {
    const u = cardUse(typical, [screen("Old monitor", { connection: "dvi" })]);
    expect(u.elsewhere[0].note).toMatch(/^Windows says it's on DVI, which this card's list doesn't have/);
  });

  it("names the 8-pin plug's pins with the clip side all ground", () => {
    const p = plugPinout("8-pin");
    expect(p.rows[0].map((x) => x.name)).toEqual(["Ground", "Ground", "Ground", "Ground"]);
    expect(p.rows[1].map((x) => `${x.number} ${x.name}`)).toEqual(["1 +12V", "2 +12V", "3 +12V", "4 Ground"]);
    expect(plugPinout("16-pin").sense).toHaveLength(4);
  });

  it("reads where the demo tower's screens connect from the inventory", () => {
    const pc = buildPC(atlas as Inventory, null, null);
    expect(pc.displays).toEqual([
      { name: "LG 27GP850", width: 2560, height: 1440, refreshHz: 60, connection: "displayport", onCard: true },
      { name: "Dell P2422H", width: 1920, height: 1080, refreshHz: 60, connection: "hdmi", onCard: true },
    ]);
  });
});
