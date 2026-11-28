// Days of the background log drawn as one chart.
import { describe, expect, it } from "vitest";
import { historyRecorded, joinRecordings, recorded } from "../src/recorded";
import type { SensorRef } from "../src/recordings";

const cpu: SensorRef = { id: "cpu/0/temp", hw: "cpu", hwName: "Ryzen", type: "temperature", name: "Tctl" };
const gpu: SensorRef = { id: "gpu/0/temp", hw: "gpu", hwName: "RTX", type: "temperature", name: "GPU Core" };

describe("joinRecordings", () => {
  it("lines each day's readings up with every day's sensors, by id, in time order", () => {
    // Yesterday the recorder saw only the processor; today it saw the graphics card first.
    const yesterday = { sensors: [cpu], samples: [{ t: 2, all: [50] }, { t: 1, all: [48] }] };
    const today = { sensors: [gpu, cpu], samples: [{ t: 10, all: [60, 55] }] };
    const r = recorded(joinRecordings([today, yesterday]));
    expect(r.points.map((p) => p.t)).toEqual([1, 2, 10]);
    const at = (id: string) => r.sensors.findIndex((s) => s.id === id);
    expect(r.points.map((p) => p.v[at("cpu/0/temp")])).toEqual([48, 50, 55]);
    expect(r.points.map((p) => p.v[at("gpu/0/temp")])).toEqual([null, null, 60]);
  });
});

describe("historyRecorded", () => {
  it("files the 10-minute history under its parts, leaving out readings the PC never gave", () => {
    const r = historyRecorded([
      { t: 2, cpu: 60, gpu: null, busy: false, cpuLoad: 30, mem: 40 },
      { t: 1, cpu: 50, gpu: null, busy: true, cpuLoad: 80, mem: 45, drive: 38 },
    ]);
    expect(r.parts.map((p) => p.name)).toEqual(["Processor", "Memory", "Storage"]);
    expect(r.points.map((p) => p.t)).toEqual([1, 2]);
    const cpu = r.parts[0];
    expect(r.sensors[cpu.lead].type).toBe("temperature");
    expect(r.points.map((p) => p.v[cpu.lead])).toEqual([50, 60]);
    expect(r.sensors.some((s) => s.part === "gpu")).toBe(false);
  });
});

describe("recorded, memory", () => {
  it("leaves out a memory stick's limit settings and tells virtual memory apart from the real thing", () => {
    const ref = (id: string, hwName: string, type: SensorRef["type"], name: string): SensorRef => ({ id, hw: "memory", hwName, type, name });
    const sensors = [
      ref("dimm/0", "DIMM #1", "temperature", "DIMM #1"),
      ref("dimm/1", "DIMM #1", "temperature", "Temperature Sensor Resolution"),
      ref("dimm/2", "DIMM #1", "temperature", "Thermal Sensor Low Limit"),
      ref("dimm/3", "DIMM #1", "temperature", "Thermal Sensor High Limit"),
      ref("ram/load", "Total Memory", "load", "Memory"),
      ref("vram/load", "Virtual Memory", "load", "Memory"),
      ref("vram/used", "Virtual Memory", "data", "Memory Used"),
    ];
    const r = recorded({ sensors, samples: [{ t: 1, all: [37, 0, 0, 0, 86, 68, 30] }] });
    expect(r.sensors.map((s) => s.name)).toEqual(["DIMM #1", "Memory", "Virtual Memory", "Virtual Memory Used"]);
    const ram = r.parts.find((p) => p.id === "ram")!;
    expect(r.sensors[ram.lead].name).toBe("Memory");
    expect(r.points[0].v[ram.lead]).toBe(86);
  });
});
