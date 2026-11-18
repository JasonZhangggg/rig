// Screenshots of the manuals feature in the demo. Usage: node shoot-manuals.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [base = "http://localhost:4173", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const errors = [];
async function page(width, height = 1000) {
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await p.goto(`${base}/app/?demo#manuals`);
  await p.getByRole("heading", { name: /Manuals for/ }).waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  return p;
}
async function step(name, fn) {
  try { await fn(); log.push(`ok ${name}`); } catch (e) { log.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}
const p = await page(1440);
await step("manuals-page", () => p.screenshot({ path: `${out}/1-manuals-page.png` }));
await step("search", async () => {
  await p.locator('input[aria-label="Search all manuals"]').fill("F_PANEL");
  await p.locator(".mn-hit").first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/2-search.png` });
});
await browser.close();
writeFileSync(`${out}/log.txt`, [...log, "", ...errors].join("\n"));
console.log([...log, ...errors.slice(0, 30)].join("\n"));
