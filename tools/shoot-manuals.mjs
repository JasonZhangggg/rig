// Screenshots of the calmer pages. Usage: node shoot-manuals.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [base = "http://localhost:4173", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
const errors = [];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const shot = (name, fullPage = false) => p.screenshot({ path: `${out}/${name}.png`, timeout: 60000, fullPage });
const go = async (hash, wait = 1500) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(wait); };
const wait = (ms) => p.waitForTimeout(ms);
async function step(name, fn) {
  try { await fn(); log.push(`ok ${name}`); } catch (e) { log.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}
await p.goto(`${base}/app/?demo#pc`);
await p.getByRole("heading", { name: /in 3D/ }).waitFor({ timeout: 30000 });
await wait(4000);
await step("pc", async () => {
  await p.locator(".part-list button", { hasText: /Storage/ }).first().hover(); await wait(900);
  await shot("01-mypc");
});
await step("pc-live", async () => {
  await p.locator(".part-list button", { hasText: /Graphics card/ }).first().click();
  await wait(2500);
  await shot("02-mypc-live-tab");
  await p.locator(".detail-back").click();
  await wait(600);
});
await step("logs", async () => {
  await go("logs", 2500);
  await shot("03-logs");
  await shot("03b-logs-full", true);
});
await step("temps", async () => {
  await go("history", 2500);
  await shot("06-temps");
  await shot("06b-temps-full", true);
  await p.getByRole("button", { name: /Hottest moment/ }).first().click();
  await wait(1200);
  await shot("06c-temps-pinned");
});
await step("games", async () => {
  await go("games", 2500);
  await shot("08-games");
});
await step("changes", async () => {
  await go("changes", 2000);
  await shot("09-changes");
});
await ctx.close();
await browser.close();
writeFileSync(`${out}/log.txt`, [...log, "", ...errors].join("\n"));
console.log([...log, ...errors.slice(0, 30)].join("\n"));
