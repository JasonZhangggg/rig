// A laptop's battery charge limit: the one line on its Battery life tab, and the offer to stop charging short of full
// when it sits on the charger at 100% most of the time. Rig sets it only on Dell and HP, through the firmware table.

import { describe, expect, it } from "vitest";
import {
  buildPC, chargeApp, chargeLimitView, chargeReadOf, checkStep, firmwareMakerOf, LocalClient, MemoryStore,
  type HistoryPoint, type Inventory, type PcReadSpec,
} from "../src";
import { DemoClient, SimulatedLink, fixtures } from "../src/demo";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 28, 15);
const pebble = fixtures.pebble.inv;
const as = (manufacturer: string, model = "Laptop"): Inventory => ({ ...pebble, machine: { ...pebble.machine, manufacturer, model } });

/** One history window every 10 minutes, oldest first, ending now: `batt` on the charger, or on battery with `drain` watts. */
function day(stretches: { hours: number; batt: number; drain?: number }[]): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  const n = stretches.reduce((a, s) => a + s.hours * 6, 0);
  let t = NOW - n * 10 * MIN;
  for (const s of stretches) for (let i = 0; i < s.hours * 6; i++, t += 10 * MIN) out.push({ t, busy: false, game: null, cpu: 50, gpu: null, cpuLoad: 10, gpuLoad: null, mem: 40, drive: null, board: null, fan: null, batt: s.batt, drain: s.drain ?? null } as HistoryPoint);
  return out;
}
const onChargerAllDay = day([{ hours: 20, batt: 100 }, { hours: 2, batt: 70, drain: 10 }]);
const mostlyOnBattery = day([{ hours: 3, batt: 100 }, { hours: 9, batt: 60, drain: 9 }]);
const onBattery = { level: 58, state: "discharging" as const, watts: 11 };

const helperRead = (now: string, extra: Record<string, unknown> = { canSet: ["on", "off"] }) => JSON.stringify({
  maker: "HP", makerTools: true, firmwarePassword: "none",
  settings: [{ setting: "virtualization", name: "Virtualization (Intel VT-x or AMD-V)", now: "On", canSet: ["on", "off"] }, { setting: "chargeLimit", name: "Battery charge limit", now, ...extra }],
  driveEncryption: "off",
});

describe("the charge limit line", () => {
  it("says charging stops where the battery holds on the charger, whoever made the laptop", () => {
    expect(chargeLimitView(as("ASUSTeK COMPUTER INC."), { level: 80, state: "plugged", watts: 0 }, [], NOW)).toEqual({ line: "Charging stops at 80% to slow wear" });
    // Held at 79-81% for an hour earlier, on battery now.
    const held = day([{ hours: 1, batt: 79 }, { hours: 1, batt: 70, drain: 8 }]);
    expect(chargeLimitView(as("Lenovo"), onBattery, held, NOW)?.line).toBe("Charging stops at 80% to slow wear");
  });

  it("says it charges to 100% once it has sat full on the charger, and offers nothing while it's mostly on battery", () => {
    expect(chargeLimitView(as("ASUS"), onBattery, mostlyOnBattery, NOW)).toEqual({ line: "Charges to 100%" });
  });

  it("says nothing when the readings don't tell, and nothing on a desktop", () => {
    expect(chargeLimitView(as("ASUS"), onBattery, [], NOW)).toBeUndefined();
    expect(chargeLimitView(fixtures.atlas.inv, null, onChargerAllDay, NOW)).toBeUndefined();
  });

  it("takes a Dell or HP firmware's own value, with HP's documented 80%", () => {
    expect(chargeLimitView(as("HP"), onBattery, onChargerAllDay, NOW, chargeReadOf(helperRead("On")))).toEqual({ line: "Charging stops at 80% to slow wear" });
    expect(chargeLimitView(as("Dell Inc."), onBattery, [], NOW, { maker: "dell", now: "on", canSet: true })?.line).toBe("Charging stops short of full to slow wear");
  });
});

describe("the offer to stop charging short of full", () => {
  it("on a laptop that sits at 100% on the charger, names the maker's own app where Rig can't set it", () => {
    const v = chargeLimitView(as("ASUS", "Zenbook 14 OLED UX3405MA"), onBattery, onChargerAllDay, NOW);
    expect(v?.line).toBe("Charges to 100%");
    expect(v?.offer).toEqual({
      title: "Stop charging at 80%", meta: "Plugged in at 100% most of the time. Set it in MyASUS.",
      ask: "My ASUS laptop is plugged in at 100% most of the time. How do I make it stop charging at 80% in MyASUS (Battery Health Charging)?",
    });
    expect(chargeLimitView(as("ASUSTeK COMPUTER INC.", "ROG Zephyrus G14 GA403UV"), onBattery, onChargerAllDay, NOW)?.offer?.meta).toContain("Armoury Crate");
    expect(chargeLimitView(as("LENOVO"), onBattery, onChargerAllDay, NOW)?.offer).toMatchObject({ title: "Stop charging short of full", meta: "Plugged in at 100% most of the time. Set it in Lenovo Vantage." });
    expect(chargeApp("Microsoft Corporation", "Surface Laptop 7")).toMatchObject({ app: "the Surface app", at: 80 });
    expect(chargeApp("Some Brand")).toEqual({ app: "your laptop maker's own app" });
  });

  it("on a Dell or HP whose firmware Rig may change, is the firmware step itself: tier 3, admin, and undone like any firmware setting", () => {
    const v = chargeLimitView(as("HP"), onBattery, onChargerAllDay, NOW, chargeReadOf(helperRead("Off")));
    expect(v?.offer).toMatchObject({ title: "Stop charging at 80%", meta: "Plugged in at 100% most of the time. It applies at the next restart." });
    const op = v!.offer!.op!;
    expect(op).toMatchObject({ name: "firmware", setting: "chargeLimit", value: "on" });
    expect(checkStep({ kind: "native", op }, { tainted: false })).toMatchObject({ status: "allowed", tier: 3, admin: true });
  });

  it("says why and where instead when Rig won't change the firmware, or doesn't know its value", () => {
    const sealed = chargeReadOf(helperRead("Off", { why: "Drive encryption is on, so Rig won't change it." }));
    expect(sealed).toEqual({ maker: "hp", now: "off", canSet: false, why: "Drive encryption is on, so Rig won't change it." });
    const v = chargeLimitView(as("HP"), onBattery, onChargerAllDay, NOW, sealed);
    expect(v?.offer?.op).toBeUndefined();
    expect(v?.offer?.meta).toBe("Plugged in at 100% most of the time. Drive encryption is on, so Rig won't change it: set it in firmware setup.");
    // Dell's Adaptive or Custom isn't a value Rig offers: it doesn't change it from under the person.
    const dell = chargeLimitView(as("Dell Inc."), onBattery, onChargerAllDay, NOW, { maker: "dell", now: "other", canSet: true });
    expect(dell?.offer).toMatchObject({ meta: "Plugged in at 100% most of the time. Set it in Dell Optimizer or Dell Power Manager." });
    expect(dell?.offer?.op).toBeUndefined();
  });

  it("reads only Rig's own row of the helper's firmware read", () => {
    expect(chargeReadOf(JSON.stringify({ maker: "not Dell, HP or Lenovo", makerTools: false }))).toBeNull();
    expect(chargeReadOf("not json")).toBeNull();
    expect(chargeReadOf(helperRead("a value Rig doesn't know"))).toMatchObject({ now: "other" });
    expect(firmwareMakerOf("Hewlett-Packard")).toBe("hp");
    expect(firmwareMakerOf("ASUSTeK COMPUTER INC.")).toBeNull();
  });
});

describe("the charge limit on the PC view", () => {
  it("reads the firmware on an HP laptop when it starts, then at most every half hour", async () => {
    const reads: PcReadSpec[] = [];
    let now = "Off";
    const link = new SimulatedLink(as("HP"), fixtures.pebble.facts, { now: () => NOW });
    Object.assign(link, { read: async (spec: PcReadSpec) => { reads.push(spec); return helperRead(now); } });
    let t = NOW;
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, factsEveryMs: 1000, now: () => (t += 1000) });
    await client.start();
    expect(reads).toEqual([{ kind: "firmware" }]);
    expect(client.view().battery?.charge?.line).toBe("Charges to 100%");
    now = "On";
    // The facts are read again every second here, but the firmware only every half hour.
    await (client as unknown as { tick(): Promise<void> }).tick();
    expect(reads).toHaveLength(1);
    client.stop();
  });

  it("reads no firmware on an ASUS laptop, and a desktop shows none of it", async () => {
    const reads: PcReadSpec[] = [];
    const link = new SimulatedLink(pebble, fixtures.pebble.facts, { now: () => NOW });
    Object.assign(link, { read: async (spec: PcReadSpec) => { reads.push(spec); return ""; } });
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9 });
    await client.start();
    expect(reads).toEqual([]);
    client.stop();
    expect(buildPC(fixtures.atlas.inv, null, fixtures.atlas.facts, {}, {}, { history: onChargerAllDay, now: NOW }).battery).toBeUndefined();
  });

  it("shows the demo's two laptops: one held at 80%, one on the charger at 100% with its maker's app", async () => {
    const pcs = await new DemoClient().machines();
    const pc = (id: string) => pcs.find((x) => x.id === id)!;
    expect(pc("demo-comet").battery?.charge).toEqual({ line: "Charging stops at 80% to slow wear" });
    expect(pc("demo-pebble").battery?.charge).toMatchObject({ line: "Charges to 100%", offer: { title: "Stop charging at 80%", meta: "Plugged in at 100% most of the time. Set it in MyASUS." } });
    expect(pc("demo-atlas").battery).toBeUndefined();
  });
});
