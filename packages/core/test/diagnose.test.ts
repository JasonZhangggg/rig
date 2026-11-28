import { describe, expect, it } from "vitest";
import {
  buildPC, classifyEvent, cpuLimit, cpuTemp, findings, ratedSpeed, score, stopCode, tjMax, stepAlerts, emptyAlertState,
  type HistoryPoint, type Inventory, type PCEvent, type RawEvent, type Sensor, type Snapshot,
} from "../src";
import { fixtures } from "../src/demo";

const NOW = Date.UTC(2026, 10, 20, 20, 0);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const atlas = (): Inventory => structuredClone(fixtures.atlas.inv);
const pebble = (): Inventory => structuredClone(fixtures.pebble.inv);

const sensor = (hw: Sensor["hw"], type: Sensor["type"], name: string, value: number | null, hwName: string = hw, max: number | null = null): Sensor =>
  ({ id: `/${hw}/${hwName}/${type}/${name}`, hw, hwName, type, name, value, min: null, max });
const snap = (...sensors: Sensor[]): Snapshot => ({ at: NOW, elevated: true, sensors });
const ids = (inv: Inventory, s: Snapshot | null, more: { events?: PCEvent[]; history?: HistoryPoint[] } = {}) =>
  findings({ inv, snap: s, facts: null, now: NOW, ...more }).map((f) => f.id);
const find = (inv: Inventory, s: Snapshot | null, id: string, more: { events?: PCEvent[]; history?: HistoryPoint[] } = {}) =>
  findings({ inv, snap: s, facts: null, now: NOW, ...more }).find((f) => f.id === id);

const withCpu = (name: string) => { const inv = atlas(); inv.cpu.name = name; return inv; };
const ev = (ago: number, source: string, id: number, message = "", level: RawEvent["level"] = "error"): PCEvent =>
  ({ t: NOW - ago, log: "System", source, id, level, message, kind: classifyEvent({ source, id }) });
const point = (ago: number, o: Partial<HistoryPoint> = {}): HistoryPoint => ({ t: NOW - ago, cpu: 50, gpu: 45, busy: false, ...o });

describe("safe limits", () => {
  it("knows each processor's published limit by name", () => {
    expect(cpuLimit("AMD Ryzen 7 9800X3D 8-Core Processor")).toBe(95);
    expect(cpuLimit("AMD Ryzen 7 7800X3D 8-Core Processor")).toBe(89);
    expect(cpuLimit("AMD Ryzen 7 5800X3D 8-Core Processor")).toBe(90);
    expect(cpuLimit("AMD Ryzen 9 5900X 12-Core Processor")).toBe(90);
    expect(cpuLimit("AMD Ryzen 5 5600X 6-Core Processor")).toBe(95);
    expect(cpuLimit("AMD Ryzen 9 7950X 16-Core Processor")).toBe(95);
    expect(cpuLimit("Intel Core Ultra 7 155H")).toBe(110);
    expect(cpuLimit("Intel(R) Core(TM) Ultra 9 285K")).toBe(105);
    expect(cpuLimit("Intel(R) Core(TM) Ultra 7 258V")).toBe(100);
    expect(cpuLimit("13th Gen Intel(R) Core(TM) i9-13900K")).toBe(100);
  });

  it("takes an Intel processor's own limit from its distance-to-limit readings", () => {
    const s = snap(sensor("cpu", "temperature", "CPU Core #1", 60), sensor("cpu", "temperature", "CPU Core #1 Distance to TjMax", 45), sensor("cpu", "temperature", "CPU Package", 62));
    expect(tjMax(s)).toBe(105);
    expect(cpuLimit("13th Gen Intel(R) Core(TM) i9-13900K", s)).toBe(105);
    expect(cpuLimit("13th Gen Intel(R) Core(TM) i9-13900K", snap(sensor("cpu", "temperature", "CPU Package", 62)))).toBe(100);
  });

  it("reads the real processor temperature whatever order the sensors come in", () => {
    // Older Ryzen X chips add 20° to Tctl; Tdie is the real one.
    expect(cpuTemp(snap(sensor("cpu", "temperature", "Core (Tctl)", 82), sensor("cpu", "temperature", "Core (Tdie)", 62)))?.value).toBe(62);
    expect(cpuTemp(snap(sensor("cpu", "temperature", "Core Average", 55), sensor("cpu", "temperature", "CPU Package", 64)))?.value).toBe(64);
    expect(cpuTemp(snap(sensor("cpu", "temperature", "CPU Core #1 Distance to TjMax", 40), sensor("cpu", "temperature", "CPU Core #1", 60)))?.value).toBe(60);
  });
});

describe("processor heat in context", () => {
  const at = (temp: number, load: number) => snap(sensor("cpu", "temperature", "Core (Tctl/Tdie)", temp), sensor("cpu", "load", "CPU Total", load));

  it("doesn't call a chip built to run at its limit broken when it's working flat out", () => {
    const f = find(withCpu("AMD Ryzen 9 7950X 16-Core Processor"), at(95, 100), "cpu-hot")!;
    expect(f.severity).toBe("warn");
    expect(f.title).toBe("Processor reached its 95°C limit under heavy load");
    expect(ids(withCpu("AMD Ryzen 9 7950X 16-Core Processor"), at(89, 100))).not.toContain("cpu-warm");
  });

  it("calls the cooler out when the processor is at its limit at rest", () => {
    const f = find(withCpu("AMD Ryzen 9 7950X 16-Core Processor"), at(95, 8), "cpu-hot")!;
    expect(f.severity).toBe("bad");
    expect(f.title).toMatch(/while barely working/);
    expect(f.evidence).toEqual(["Core (Tctl/Tdie) 95°C, limit 95°C", "Processor load 8%"]);
  });

  it("still treats an X3D chip at its limit as a problem", () => {
    expect(find(atlas(), at(89, 100), "cpu-hot")!.severity).toBe("bad");
  });

  it("notices a processor that runs hot at rest for days", () => {
    const quiet = Array.from({ length: 20 }, (_, i) => point(i * HOUR, { cpu: 74, cpuLoad: 4 }));
    expect(ids(atlas(), null, { history: quiet })).toContain("cpu-hot-idle");
    const cool = quiet.map((p) => ({ ...p, cpu: 48 }));
    expect(ids(atlas(), null, { history: cool })).not.toContain("cpu-hot-idle");
    expect(ids(atlas(), null, { history: quiet.slice(0, 5) })).not.toContain("cpu-hot-idle");
  });
});

describe("graphics card", () => {
  const card = (core: number, hot: number, load: number, mem = 70) => snap(
    sensor("gpu", "temperature", "GPU Core", core), sensor("gpu", "temperature", "GPU Hot Spot", hot),
    sensor("gpu", "temperature", "GPU Memory Junction", mem), sensor("gpu", "load", "GPU Core", load));

  it("flags a hot spot far above the core under load, which points at the paste", () => {
    expect(ids(atlas(), card(66, 98, 98))).toContain("gpu-hotspot-gap");
    // Near its limit, the hot spot gets the stronger finding instead.
    expect(ids(atlas(), card(70, 104, 98))).not.toContain("gpu-hotspot-gap");
    expect(ids(atlas(), card(70, 82, 98))).not.toContain("gpu-hotspot-gap");
    expect(ids(atlas(), card(40, 72, 5))).not.toContain("gpu-hotspot-gap");
  });

  it("flags a hot spot near its limit and hot memory", () => {
    expect(ids(atlas(), card(80, 104, 99))).toContain("gpu-hotspot-hot");
    expect(ids(atlas(), card(70, 82, 98, 104))).toContain("gpu-vram-hot");
  });

  it("reads the core, not the hot spot, as the card's temperature", () => {
    const pc = buildPC(atlas(), snap(sensor("gpu", "temperature", "GPU Hot Spot", 90, "NVIDIA GeForce RTX 4070 SUPER"), sensor("gpu", "temperature", "GPU Core", 70, "NVIDIA GeForce RTX 4070 SUPER")), null);
    expect(pc.parts!.gpu.temp).toBe(70);
  });
});

describe("drives", () => {
  const drive = (o: Partial<Inventory["disks"][number]>) => { const inv = atlas(); inv.disks = [{ ...inv.disks[0], ...o }]; return inv; };

  it("doesn't call a drive with most of its life left worn out", () => {
    expect(ids(drive({ healthPercent: 79 }), null)).not.toContain("disk-Samsung SSD 990 PRO 2TB");
    expect(find(drive({ healthPercent: 15 }), null, "disk-Samsung SSD 990 PRO 2TB")!.severity).toBe("warn");
    expect(find(drive({ healthPercent: 5 }), null, "disk-Samsung SSD 990 PRO 2TB")!.severity).toBe("bad");
  });

  it("passes on Windows' own verdict on the drive", () => {
    const f = find(drive({ status: "unhealthy" }), null, "disk-status-Samsung SSD 990 PRO 2TB")!;
    expect(f).toMatchObject({ severity: "bad", title: "Windows says Samsung SSD 990 PRO 2TB is failing", confidence: "sure" });
    expect(ids(drive({ status: "healthy" }), null).filter((i) => i.startsWith("disk-"))).toEqual([]);
  });

  it("notices an NVMe drive out of spare blocks", () => {
    const name = "Samsung SSD 990 PRO 2TB";
    expect(ids(atlas(), snap(sensor("storage", "level", "Available Spare", 5, name), sensor("storage", "level", "Available Spare Threshold", 10, name)))).toContain(`disk-spare-${name}`);
    expect(ids(atlas(), snap(sensor("storage", "level", "Available Spare", 100, name), sensor("storage", "level", "Available Spare Threshold", 10, name)))).not.toContain(`disk-spare-${name}`);
  });

  it("reads each drive's own temperature", () => {
    const inv = atlas();
    inv.disks.push({ model: "WDC WD40EZAZ", sizeGb: 4000, media: "hdd" });
    const s = snap(sensor("storage", "temperature", "Temperature", 58, "WDC WD40EZAZ"), sensor("storage", "temperature", "Temperature", 41, "Samsung SSD 990 PRO 2TB"));
    expect(ids(inv, s)).toEqual(expect.arrayContaining(["disk-hot-WDC WD40EZAZ"]));
    expect(ids(inv, s)).not.toContain("disk-hot-Samsung SSD 990 PRO 2TB");
    expect(buildPC(inv, s, null).parts!.ssd.temp).toBe(41);
  });
});

describe("memory", () => {
  const kit = (speed: number, partNumber = "CMK32GX5M2B6000C30", n = 2) => {
    const inv = atlas();
    inv.memory.modules = Array.from({ length: n }, () => ({ manufacturer: "Corsair", partNumber, capacityMb: 16384, speedMhz: speed }));
    return inv;
  };

  it("reads a kit's rated speed from its part number", () => {
    expect(ratedSpeed("CMK32GX5M2B6000C30")).toBe(6000);
    expect(ratedSpeed("CMK16GX4M2B3200C16")).toBe(3200);
    expect(ratedSpeed("F4-3600C16-8GTZNC")).toBe(3600);
    expect(ratedSpeed("KF560C36BBE-16")).toBe(5600);
    expect(ratedSpeed("BL2K16G36C16U4B")).toBe(3600);
    expect(ratedSpeed("TF3D416G3200HC16F01")).toBe(3200);
    expect(ratedSpeed("M378A1K43EB2-CWE")).toBeNull();
  });

  it("says when memory runs below its rated speed", () => {
    expect(find(kit(4800), null, "mem-slow")!.title).toBe("Memory runs at 4800 MT/s but is rated for 6000");
    expect(ids(kit(6000), null)).not.toContain("mem-slow");
    // Some boards report the clock, half the transfer rate.
    expect(ids(kit(3000), null)).not.toContain("mem-slow");
    expect(ids(kit(2400, "M378A1K43EB2-CWE"), null)).not.toContain("mem-slow");
  });

  it("notices a desktop running on one memory stick", () => {
    expect(ids(kit(6000, "CMK32GX5M2B6000C30", 1), null)).toContain("mem-single");
    expect(ids(kit(6000), null)).not.toContain("mem-single");
  });
});

describe("firmware and drivers", () => {
  const board = (cpu: string, biosDate: string, kind: "tower" | "laptop" = "tower") => { const inv = withCpu(cpu); inv.board.biosDate = biosDate; inv.machine.kind = kind; return inv; };

  it("asks for Intel's BIOS fix on 13th and 14th gen desktop chips", () => {
    expect(ids(board("13th Gen Intel(R) Core(TM) i9-13900K", "Mar 2024"), null)).toContain("bios-intel-fix");
    expect(ids(board("14th Gen Intel(R) Core(TM) i7-14700KF", "Jun 2024"), null)).toContain("bios-intel-fix");
    expect(ids(board("13th Gen Intel(R) Core(TM) i9-13900K", "Oct 2024"), null)).not.toContain("bios-intel-fix");
    expect(ids(board("13th Gen Intel(R) Core(TM) i7-13700H", "Mar 2024", "laptop"), null)).not.toContain("bios-intel-fix");
    expect(ids(board("12th Gen Intel(R) Core(TM) i7-12700K", "Mar 2023"), null)).not.toContain("bios-intel-fix");
  });

  it("asks for AMD's voltage fix on early Ryzen 7000 BIOS versions", () => {
    expect(ids(board("AMD Ryzen 7 7800X3D 8-Core Processor", "Feb 2023"), null)).toContain("bios-am5-fix");
    expect(ids(board("AMD Ryzen 7 7800X3D 8-Core Processor", "Mar 2026"), null)).not.toContain("bios-am5-fix");
  });

  it("mentions a graphics driver over a year old", () => {
    const inv = atlas();
    inv.gpus[0].driverDate = "Oct 3, 2025";
    expect(ids(inv, null)).toContain("gpu-driver-old");
    expect(ids(atlas(), null)).not.toContain("gpu-driver-old");
  });
});

describe("crashes, shutdowns and errors", () => {
  const blueScreen = (ago: number, code: string) => [
    ev(ago, "Microsoft-Windows-WER-SystemErrorReporting", 1001, `The computer has rebooted from a bugcheck. The bugcheck was: ${code} (0x0000000000000000, 0xffffb38e12f1a028).`),
    ev(ago + 30_000, "Microsoft-Windows-Kernel-Power", 41, "The system has rebooted without cleanly shutting down first.", "critical"),
  ];

  it("reads the stop code out of a blue screen", () => {
    expect(stopCode("The bugcheck was: 0x00000124 (0x0, 0x1)")).toBe(0x124);
    expect(stopCode("nothing here")).toBeNull();
  });

  it("explains what repeated blue screens point at, without counting them as power cuts", () => {
    const events = [...blueScreen(2 * DAY, "0x00000124"), ...blueScreen(5 * DAY, "0x00000124")];
    const fs = findings({ inv: atlas(), snap: null, facts: null, now: NOW, events });
    const f = fs.find((x) => x.id === "crashes")!;
    expect(f).toMatchObject({ severity: "bad", title: "Windows crashed twice in two weeks", confidence: "likely" });
    expect(f.body).toMatch(/point at the hardware/);
    expect(f.body).toMatch(/Memory runs above the standard speed/);
    expect(f.evidence).toContain("Stop code 0x124 WHEA_UNCORRECTABLE_ERROR");
    expect(fs.map((x) => x.id).filter((i) => i.startsWith("shutdowns"))).toEqual([]);
  });

  it("ties sudden shutdowns to heat when the card was near its limit just before", () => {
    const events = [ev(1 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical"), ev(3 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical")];
    const history = [point(1 * DAY + 5 * MIN, { gpu: 86, busy: true, game: "Cyberpunk 2077" }), point(3 * DAY + 5 * MIN, { gpu: 85, busy: true })];
    const f = find(atlas(), null, "shutdowns-hot", { events, history })!;
    expect(f.body).toMatch(/^Each time, the graphics card was near its limit/);
  });

  it("points at power when the PC shut off under load while cool", () => {
    const events = [ev(1 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical"), ev(3 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical")];
    const history = [point(1 * DAY + 5 * MIN, { gpu: 66, gpuLoad: 97, busy: true, game: "Cyberpunk 2077" }), point(3 * DAY + 5 * MIN, { gpu: 64, gpuLoad: 95, busy: true })];
    const f = find(atlas(), null, "shutdowns-load", { events, history })!;
    expect(f).toMatchObject({ part: "psu", title: "The PC shut off twice under load" });
    expect(f.body).toMatch(/Cyberpunk 2077/);
  });

  it("calls a laptop a laptop when it shuts off, and points at the charger and battery", () => {
    const events = [ev(1 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical"), ev(3 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical")];
    const history = [point(1 * DAY + 5 * MIN, { gpu: 66, gpuLoad: 97, busy: true }), point(3 * DAY + 5 * MIN, { gpu: 64, gpuLoad: 95, busy: true })];
    const load = find(pebble(), null, "shutdowns-load", { events, history })!;
    expect(load.title).toBe("The laptop shut off twice under load");
    expect(load.body).toMatch(/charger/);
    expect(`${load.body} ${load.ask}`).not.toMatch(/\bPC\b|power supply/i);
    const cold = find(pebble(), null, "shutdowns", { events })!;
    expect(`${cold.title} ${cold.body} ${cold.ask}`).not.toMatch(/\bPC\b|power supply/i);
  });

  it("names a laptop nobody named My laptop, live on this laptop", () => {
    const inv = pebble(); inv.machine.hostname = "LAPTOP-8QX2M1";
    expect(buildPC(inv, null, null)).toMatchObject({ name: "My laptop", lastSync: "Live on this laptop" });
    const desk = atlas(); desk.machine.hostname = "DESKTOP-4KF2J9";
    expect(buildPC(desk, null, null)).toMatchObject({ name: "My PC", lastSync: "Live on this PC" });
  });

  it("names a laptop's maker the short way under its name", () => {
    expect(buildPC(structuredClone(fixtures.comet.inv), null, null).nickname).toBe("ASUS laptop");
    expect(buildPC(pebble(), null, null).nickname).toBe("ASUS laptop");
    const plain = pebble(); plain.machine.manufacturer = "";
    expect(buildPC(plain, null, null).nickname).toBe("Laptop");
    expect(buildPC(atlas(), null, null).nickname).toBe("Desktop");
  });

  it("says when a single power cut is all there is", () => {
    expect(ids(atlas(), null, { events: [ev(1 * DAY, "Microsoft-Windows-Kernel-Power", 41, "", "critical")] }).filter((i) => i.startsWith("shutdowns"))).toEqual([]);
  });

  it("tells heat from the driver when the graphics driver keeps resetting", () => {
    const events = [1, 2, 3].map((d) => ev(d * DAY, "Display", 4101, "Display driver nvlddmkm stopped responding and has successfully recovered.", "warning"));
    const hot = [1, 2, 3].map((d) => point(d * DAY + 2 * MIN, { gpu: 86, busy: true }));
    expect(find(atlas(), null, "driver-resets", { events, history: hot })!.body).toMatch(/heat is the likely cause/);
    const cool = hot.map((p) => ({ ...p, gpu: 62 }));
    expect(find(atlas(), null, "driver-resets", { events, history: cool })!.body).toMatch(/driver itself or an overclock/);
  });

  it("names a PCIe link when it keeps correcting errors", () => {
    const events = Array.from({ length: 12 }, (_, i) => ev(i * HOUR, "Microsoft-Windows-WHEA-Logger", 17, "A corrected hardware error has occurred.", "warning"));
    expect(find(atlas(), null, "whea-corrected", { events })!.body).toMatch(/PCIe link/);
    expect(ids(atlas(), null, { events: events.slice(0, 3) })).not.toContain("whea-corrected");
  });

  it("takes bad blocks on a drive seriously", () => {
    const f = find(atlas(), null, "disk-errors", { events: [ev(DAY, "disk", 7, "The device, \\Device\\Harddisk1\\DR1, has a bad block.")] })!;
    expect(f).toMatchObject({ severity: "bad", title: "A drive reported bad blocks" });
  });

  it("scores crashes in their own category once Rig has read the events", () => {
    const quiet = buildPC(atlas(), null, null, {}, {}, { events: [], now: NOW });
    expect(quiet.breakdown!.map((b) => b.label)).toContain("Crashes and errors");
    expect(quiet.breakdown!.find((b) => b.label === "Crashes and errors")!.note).toBe("No crashes lately");
    expect(buildPC(atlas(), null, null).breakdown!.map((b) => b.label)).not.toContain("Crashes and errors");
    const fs = findings({ inv: atlas(), snap: null, facts: null, now: NOW, events: [...blueScreen(DAY, "0x0000001A")] });
    expect(score(false, fs).breakdown.find((b) => b.label === "Crashes and errors")!.sev).toBe("warn");
  });
});

describe("a stopped fan's name", () => {
  it("only calls a board header the processor's when it says so", () => {
    const hot = (fan: string): Snapshot => ({ at: 0, elevated: true, sensors: [
      sensor("cpu", "temperature", "Core (Tctl/Tdie)", 80), sensor("board", "fan", fan, 0, "board", 1400),
    ] });
    const title = (fan: string) => {
      let state = emptyAlertState(), alerts: { title: string }[] = [];
      for (let t = 0; t <= 60_000; t += 10_000) ({ state, alerts } = stepAlerts(state, { inv: atlas(), snap: hot(fan), history: [], now: t }));
      return alerts.map((a) => a.title);
    };
    expect(title("Fan #1")).toEqual(["A fan on the motherboard (Fan #1) has stopped"]);
    expect(title("CPU Fan")).toEqual(["Processor fan has stopped"]);
  });
});

it("keeps the laptop's limit from its chip", () => {
  expect(buildPC(pebble(), null, null).parts!.cpu.limit).toBe(110);
});
