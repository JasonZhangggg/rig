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
await step("upgrades", async () => {
  await p.evaluate(() => { location.hash = "upgrades"; });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/11-upgrades-link.png` });
});
await step("viewer", async () => {
  await p.locator('input[aria-label="Search all manuals"]').fill("");
  await p.getByRole("button", { name: "Open", exact: true }).first().click();
  await p.locator(".mv-canvas").waitFor({ timeout: 20000 });
  const layout = p.locator(".mv-rail button", { hasText: /layout/i }).first();
  if (await layout.count()) await layout.click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${out}/3-viewer-board-layout.png` });
  const front = p.locator(".mv-rail button", { hasText: /front panel/i }).first();
  if (await front.count()) { await front.click(); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/4-viewer-front-panel.png` }); }
  await p.keyboard.press("Escape");
});
await step("phone", async () => {
  const q = p;
  await q.setViewportSize({ width: 390, height: 844 });
  await q.reload(); await q.getByRole("heading", { name: /Manuals for/ }).waitFor({ timeout: 30000 });
  await q.waitForTimeout(1500);
  await q.screenshot({ path: `${out}/12-phone-manuals.png` });
  await q.getByRole("button", { name: "Open", exact: true }).first().click();
  await q.locator(".mv-canvas").waitFor({ timeout: 20000 });
  await q.waitForTimeout(3000);
  await q.screenshot({ path: `${out}/13-phone-viewer.png` });
  await q.keyboard.press("Escape");
  await q.setViewportSize({ width: 1440, height: 1000 });
});
await step("laptop-find", async () => {
  // The demo's other PC: switch, then find its manual.
  const q = p;
  await q.evaluate(() => { location.hash = "manuals"; });
  await q.waitForTimeout(1000);
  const menu = q.locator(".sh-pc, [aria-haspopup='menu']").first();
  if (await menu.count()) { await menu.click(); const other = q.getByRole("menuitem").nth(1); if (await other.count()) await other.click(); }
  await q.waitForTimeout(1500);
  await q.screenshot({ path: `${out}/5-other-pc-before.png` });
  const find = q.getByRole("button", { name: "Find manual" }).first();
  if (await find.count()) { await find.click(); await q.waitForTimeout(500); await q.screenshot({ path: `${out}/6-finding.png` }); await q.waitForTimeout(8000); await q.screenshot({ path: `${out}/7-found.png` }); }
});
await step("part-tab", async () => {
  await p.evaluate(() => { location.hash = "pc"; });
  await p.waitForTimeout(2500);
  await p.locator(".part-list button", { hasText: /Motherboard/ }).first().click();
  await p.waitForTimeout(800);
  await p.getByRole("tab", { name: "Manual" }).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/8-part-manual-tab.png` });
});
await step("chat", async () => {
  await p.evaluate(() => { location.hash = "chat"; });
  await p.waitForTimeout(1500);
  const box = p.locator("textarea").first();
  await box.fill("Where do I plug in the front panel cables?");
  await box.press("Enter");
  await p.locator(".sources").last().waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/9-chat-manual-source.png` });
  const src = p.locator(".sources a, .sources button", { hasText: /page/i }).first();
  if (await src.count()) { await src.click(); await p.waitForTimeout(3000); await p.screenshot({ path: `${out}/10-chat-source-opens-page.png` }); await p.keyboard.press("Escape"); }
});
await browser.close();
writeFileSync(`${out}/log.txt`, [...log, "", ...errors].join("\n"));
console.log([...log, ...errors.slice(0, 30)].join("\n"));
