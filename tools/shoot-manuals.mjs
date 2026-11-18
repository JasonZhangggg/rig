// Screenshots of each page for the flat-pages review. Usage: node shoot-manuals.mjs <baseUrl> <outDir>
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
const shot = (name, fullPage = false) => p.screenshot({ path: `${out}/${name}.png`, timeout: 60000, animations: "disabled", fullPage });
const go = async (hash, wait = 1500) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(wait); };
const click = (loc) => loc.first().evaluate((el) => el.click());
async function step(name, fn) {
  try { await fn(); log.push(`ok ${name}`); } catch (e) { log.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}
await p.goto(`${base}/app/?demo#logs`);
await p.getByRole("heading", { name: "Logs" }).waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await step("logs-events", () => shot("01-logs-events", true));
await step("recording", async () => { await click(p.getByText(/See the timeline and readings/)); await p.waitForTimeout(2000); await shot("02-logs-recording", true); });
await step("logs-temps", async () => { await go("history", 2500); await shot("03-logs-temperatures", true); });
await step("logs-games", async () => { await go("games", 2500); await shot("04-logs-games", true); });
await step("game-detail", async () => { await click(p.getByRole("button", { name: /See Cyberpunk 2077/ })); await p.waitForTimeout(2000); await shot("05-game-detail", true); });
await step("changes", async () => { await go("changes", 2000); await shot("06-changes", true); });
await step("settings", async () => { await go("settings", 2000); await shot("07-settings", true); });
await step("chat", async () => { await go("chat", 1500); await shot("08-ask"); });
await step("home", async () => { await go("overview", 3000); await shot("09-home"); });
await step("pc", async () => { await go("pc", 4000); await shot("10-mypc", true); });
await step("board-manual", async () => {
  await click(p.locator(".part-list button", { hasText: /Motherboard/ }));
  await p.waitForTimeout(500);
  await click(p.getByRole("tab", { name: "Manual" }));
  await p.waitForTimeout(1500);
  await shot("11-mypc-part-manual");
});
await step("phone", async () => {
  await click(p.locator(".detail-back"));
  await p.setViewportSize({ width: 390, height: 844 });
  await go("pc", 3000);
  await shot("12-phone-mypc", true);
});
await browser.close();
writeFileSync(`${out}/log.txt`, [...log, "", ...errors].join("\n"));
console.log([...log, ...errors.slice(0, 30)].join("\n"));
