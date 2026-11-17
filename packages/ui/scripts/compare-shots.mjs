#!/usr/bin/env node
// Pixel-compares same-named PNGs in two folders and writes diff images.
//
//   node packages/ui/scripts/compare-shots.mjs <expected-dir> <actual-dir> [diff-dir]
//
// Exits non-zero when any pair differs in size or in more than --max pixels.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const maxAt = args.indexOf("--max");
const max = maxAt >= 0 ? Number(args.splice(maxAt, 2)[1]) : 0;
const [expectedDir, actualDir, diffDir] = args;
if (!expectedDir || !actualDir) { console.error("usage: compare-shots.mjs <expected-dir> <actual-dir> [diff-dir] [--max N]"); process.exit(2); }
if (diffDir) mkdirSync(diffDir, { recursive: true });

let failed = false;
for (const name of readdirSync(expectedDir).filter((f) => f.endsWith(".png")).sort()) {
  let actual;
  try { actual = PNG.sync.read(readFileSync(join(actualDir, name))); } catch { console.log(`${name}: missing`); failed = true; continue; }
  const expected = PNG.sync.read(readFileSync(join(expectedDir, name)));
  if (expected.width !== actual.width || expected.height !== actual.height) {
    console.log(`${name}: size ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`);
    failed = true;
    continue;
  }
  const diff = new PNG({ width: expected.width, height: expected.height });
  const n = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 });
  if (diffDir && n) writeFileSync(join(diffDir, name), PNG.sync.write(diff));
  let box = "";
  if (n) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < diff.height; y++) for (let x = 0; x < diff.width; x++) {
      const k = (y * diff.width + x) * 4;
      if (diff.data[k] === 255 && diff.data[k + 1] < 100) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 >= 0) box = ` within x ${x0}-${x1}, y ${y0}-${y1}`;
  }
  console.log(`${name}: ${n} px differ${box}`);
  if (n > max) failed = true;
}
process.exit(failed ? 1 : 0);
