import { describe, expect, it } from "vitest";
import { calloutsFit, createSceneLabels, relax, roomFor, splitSides, spreadColumn } from "../src/sceneLabels";

const items = [
  { id: "cpu", title: "CPU", value: "52°" },
  { id: "gpu", title: "GPU", value: "88°", warn: true },
  { id: "ram", title: "Memory" },
];
const points = [
  { id: "cpu", x: 500, y: 200 },
  { id: "gpu", x: 520, y: 420 },
  { id: "ram", x: 560, y: 180 },
];
const box = { x0: 380, y0: 100, x1: 760, y1: 620 };

describe("part labels", () => {
  it("keeps a column of callouts in order, apart and on the stage", () => {
    // Three parts close together near the top: their labels stack down without touching.
    const y = spreadColumn([20, 24, 30], [30, 30, 30], 10, 400, 12);
    expect(y[0]).toBeGreaterThanOrEqual(10);
    expect(y[1] - y[0]).toBeGreaterThanOrEqual(42);
    expect(y[2] - y[1]).toBeGreaterThanOrEqual(42);
    // Near the bottom, they stack up instead of running off.
    const z = spreadColumn([390, 395], [30, 30], 10, 400, 12);
    expect(z[1] + 30).toBeLessThanOrEqual(400);
    expect(z[1] - z[0]).toBeGreaterThanOrEqual(42);
  });

  it("splits callouts between the two sides evenly", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, x: 100 + i * 5, y: i * 40 }));
    const side = splitSides(pts, 300);
    const left = Object.values(side).filter((s) => s < 0).length;
    expect(Math.abs(left - (pts.length - left))).toBeLessThanOrEqual(1);
  });

  it("pushes overlapping phone markers apart", () => {
    const [a, b] = relax([{ x: 100, y: 100, w: 24, h: 24 }, { x: 104, y: 104, w: 24, h: 24 }], 3);
    const apart = a.y + a.h + 3 <= b.y + 0.01 || b.y + b.h + 3 <= a.y + 0.01 || a.x + a.w + 3 <= b.x + 0.01 || b.x + b.w + 3 <= a.x + 0.01;
    expect(apart).toBe(true);
  });

  it("uses columns on a wide stage and a numbered list on a phone", () => {
    expect(calloutsFit(1200)).toBe(true);
    expect(calloutsFit(390)).toBe(false);
    expect(roomFor(1200, 7).l).toBeGreaterThan(100);
    expect(roomFor(390, 7).b).toBeGreaterThan(150);
  });

  it("shows each part's name and temperature beside the model, joined by a line", () => {
    const layer = document.createElement("div");
    const labels = createSceneLabels(layer);
    labels.setItems(items);
    labels.layout(points, { width: 1200, height: 720, box });
    const shown = [...layer.querySelectorAll<HTMLElement>(".co-label:not(.is-off)")];
    expect(shown.map((l) => l.textContent)).toEqual(["CPU52°", "GPU88°", "Memory"]);
    expect(layer.querySelector(".co-value.is-warn")?.textContent).toBe("88°");
    expect([...layer.querySelectorAll(".co-line")].every((p) => p.getAttribute("d")?.startsWith("M"))).toBe(true);
    expect(layer.querySelector<HTMLElement>(".callouts")!.dataset.mode).toBe("callouts");
  });

  it("on a phone, numbers each part and lists what the numbers are", () => {
    const layer = document.createElement("div");
    const labels = createSceneLabels(layer);
    labels.setItems(items);
    labels.layout(points, { width: 390, height: 600, box });
    expect(layer.querySelector<HTMLElement>(".callouts")!.dataset.mode).toBe("numbers");
    expect([...layer.querySelectorAll<HTMLElement>(".co-mark")].map((m) => m.dataset.n)).toEqual(["1", "2", "3"]);
    expect([...layer.querySelectorAll(".co-legend li b")].map((b) => b.textContent)).toEqual(["CPU", "GPU", "Memory"]);
  });

  it("can show only the picked part's label, with no room kept for the others", () => {
    const layer = document.createElement("div");
    const labels = createSceneLabels(layer);
    labels.setItems(items);
    labels.setPickedOnly(true);
    expect(labels.room(1200)).toBeNull();
    labels.layout(points, { width: 1200, height: 720, box, selected: "gpu" });
    expect([...layer.querySelectorAll<HTMLElement>(".co-label:not(.is-off)")].map((l) => l.dataset.part)).toEqual(["gpu"]);
    labels.layout(points, { width: 1200, height: 720, box });
    expect(layer.querySelectorAll(".co-label:not(.is-off)").length).toBe(0);
  });

  it("keeps labels clear of the view's buttons along the bottom", () => {
    const layer = document.createElement("div");
    const labels = createSceneLabels(layer);
    labels.setItems(items);
    // Every part sits low, where the Exploded view, Heat and Reset view buttons are.
    const low = items.map((it, i) => ({ id: it.id, x: 500 + i * 20, y: 690 }));
    labels.layout(low, { width: 1200, height: 720, box: { ...box, y1: 715 }, foot: 60 });
    const tops = [...layer.querySelectorAll<HTMLElement>(".co-label")].map((l) => Number(/translate\([^,]+,\s*([-\d.]+)px\)/.exec(l.style.transform)![1]));
    expect(tops.length).toBe(3);
    for (const y of tops) expect(y).toBeLessThanOrEqual(720 - 60);
  });

    it("names the part a label points at, for pointing and picking", () => {
    const layer = document.createElement("div");
    const picked: string[] = [];
    const labels = createSceneLabels(layer, { onPick: (id) => picked.push(id) });
    labels.setItems(items);
    labels.layout(points, { width: 1200, height: 720, box });
    layer.querySelector<HTMLButtonElement>('.co-label[data-part="ram"]')!.click();
    expect(picked).toEqual(["ram"]);
  });
});
