// Screenshots and a short clip of the interactive pages. Usage: node shoot-manuals.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, renameSync } from "node:fs";
const [base = "http://localhost:4173", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
const errors = [];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: `${out}/video`, size: { width: 1440, height: 900 } } });
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
await step("pc-hover", async () => {
  for (const name of [/Graphics card/, /Memory/, /Storage/]) { await p.locator(".part-list button", { hasText: name }).first().hover(); await wait(900); }
  await shot("01-mypc-hover-part");
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
  await p.locator(".lg-count", { hasText: /Driver/ }).first().click();
  await wait(1000);
  await p.locator(".ev-head").first().click();
  await wait(1200);
  await shot("04-logs-filtered-open");
});
await step("logs-day", async () => {
  await p.locator(".lg-count", { hasText: /^\s*\d+\s*All/ }).first().click().catch(() => {});
  await wait(600);
  const day = p.locator(".ev-day:has(.ev-dots i)").first();
  await day.hover(); await wait(700);
  await shot("05-logs-day-hover");
  await day.click(); await wait(900);
});
await step("temps", async () => {
  await go("history", 2500);
  await p.getByRole("button", { name: /Hottest moment/ }).first().click();
  await wait(1200);
  await shot("06-temps-pinned");
  const chart = p.locator("svg.chart").first();
  const box = await chart.boundingBox();
  if (box) { for (let i = 1; i <= 6; i++) { await p.mouse.move(box.x + box.width * (0.15 + i * 0.1), box.y + box.height * 0.5); await wait(250); } }
  await shot("07-temps-hover");
});
await step("games", async () => {
  await go("games", 2500);
  await p.getByRole("group", { name: "Sort games" }).getByRole("button", { name: "Hottest" }).click();
  await wait(1000);
  await shot("08-games-sorted");
});
await step("changes", async () => {
  await go("changes", 2000);
  await shot("09-changes");
});
await step("recording", async () => {
  await go("logs", 2000);
  await p.getByText(/See the timeline and readings|Open/).first().click().catch(() => {});
  await wait(2000);
  const chart = p.locator("svg.chart").first();
  await chart.focus(); await p.keyboard.press("End"); await wait(200);
  for (let i = 0; i < 12; i++) { await p.keyboard.press("Shift+ArrowLeft"); await wait(120); }
  await shot("10-recording-readout");
});
await ctx.close();
await browser.close();
const vids = readdirSync(`${out}/video`).filter((f) => f.endsWith(".webm"));
if (vids[0]) renameSync(`${out}/video/${vids[0]}`, `${out}/clip.webm`);
writeFileSync(`${out}/log.txt`, [...log, "", ...errors].join("\n"));
console.log([...log, ...errors.slice(0, 30)].join("\n"));
