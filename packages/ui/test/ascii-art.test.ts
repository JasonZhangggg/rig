import { describe, expect, it } from "vitest";
import { paintArt, type AsciiArtData } from "../src/components/AsciiArt";

function fakeCanvas() {
  const calls: { text: string; x: number; y: number; fill: string; alpha: number }[] = [];
  const ctx = {
    fillStyle: "", globalAlpha: 1, font: "", textBaseline: "",
    setTransform() {}, strokeStyle: "", lineWidth: 0, strokeText() {},
    fillText(text: string, x: number, y: number) { calls.push({ text, x, y, fill: String(this.fillStyle), alpha: this.globalAlpha }); },
  };
  const canvas = { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe("text-character art", () => {
  const art: AsciiArtData = { cols: 4, rows: ["@@ #", "  =="], colors: ["!! $", "  #!"], palette: ["#ff0000", "#00ff00", 0.5] };

  it("draws each run of one colour and skips the gaps", () => {
    const { canvas, calls } = fakeCanvas();
    paintArt(canvas, art, 400, "rgb(27, 27, 31)", 1);
    expect(calls.map((c) => [c.text, c.fill])).toEqual([["@@", "#ff0000"], ["#", "rgb(27, 27, 31)"], ["=", "#00ff00"], ["=", "#ff0000"]]);
    expect(calls[1]).toMatchObject({ x: 300, alpha: 0.5 });
  });

  it("fills the width it is given and keeps its shape", () => {
    const { canvas } = fakeCanvas();
    paintArt(canvas, art, 400, "#000", 2);
    expect(canvas.width).toBe(800);
    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe(`${Math.ceil(2 * (100 / 0.602) * 1.09)}px`);
  });
});
