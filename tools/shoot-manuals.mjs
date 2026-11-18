// Screenshots of the fewer-pages layout in the demo. Usage: node shoot-manuals.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [base = "http://localhost:4173", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
const errors = [];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const shot = (name) => p.screenshot({ path: `${out}/${name}.png`, timeout: 60000, animations: "disabled" });
const go = async (hash, wait = 1500) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(wait); };
const click = (loc) => loc.first().evaluate((el) => el.click());
async function step(name, fn) {
  try { await fn(); log.push(`ok ${name}`); } catch (e) { log.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}
await p.goto(`${base}/app/?demo#logs`);
await p.getByRole("heading", { name: "Logs" }).waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await step("logs-events", () => shot("1-logs-events"));
await step("logs-temps", async () => { await go("history", 2500); await shot("2-logs-temperatures"); });
await step("logs-games", async () => { await go("games", 2500); await shot("3-logs-games"); });
await step("ctrl-k", async () => {
  await p.keyboard.press("Control+k");
  await p.waitForTimeout(500);
  await p.locator('input[aria-label="Search"]').fill("F_PANEL");
  await p.waitForTimeout(1500);
  await shot("4-ctrl-k-manuals");
  await p.keyboard.press("Escape");
});
await step("chat", async () => { await go("chat", 1500); await shot("5-ask"); });
await step("pc", async () => { await go("pc", 4000); await shot("6-mypc-parts-upgrades"); });
await step("part-upgrade", async () => {
  await click(p.locator(".pc-ups-list button", { hasText: /SSD/ }));
  await p.waitForTimeout(1500);
  await shot("7-part-upgrade-tab");
});
await step("board-manual", async () => {
  await click(p.locator(".detail-back"));
  await p.waitForTimeout(500);
  await click(p.locator(".part-list button", { hasText: /Motherboard/ }));
  await p.waitForTimeout(500);
  await click(p.getByRole("tab", { name: "Manual" }));
  await p.waitForTimeout(1500);
  await shot("8-part-manual-tab");
});
await step("case-manual", async () => {
  await click(p.locator(".detail-back"));
  await p.waitForTimeout(500);
  await click(p.locator(".part-list button", { hasText: /^Case/ }));
  await p.waitForTimeout(500);
  await click(p.getByRole("tab", { name: "Manual" }));
  await p.waitForTimeout(1500);
  await shot("9-case-manual-tab");
});
await step("phone", async () => {
  await click(p.locator(".detail-back"));
  await p.setViewportSize({ width: 390, height: 844 });
  await go("logs", 2500);
  await shot("10-phone-logs");
});
await browser.close();
writeFileSync(`${out}/log.txt`, [...log, "", ...errors].join("\n"));
console.log([...log, ...errors.slice(0, 30)].join("\n"));
