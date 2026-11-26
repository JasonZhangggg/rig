// Days of the background log drawn as one chart.
import { describe, expect, it } from "vitest";
import { joinRecordings, recorded } from "../src/recorded";
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
