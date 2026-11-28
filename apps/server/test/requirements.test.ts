import { describe, expect, it } from "vitest";
import type { GameRequirements } from "@rig/core";
import { fakeClaude, setup, type FakeRound } from "./helpers";

const URL_ = "https://store.steampowered.com/app/1551360/Forza_Horizon_5/";
const PAGE = `Forza Horizon 5 on Steam
SYSTEM REQUIREMENTS
MINIMUM:
Requires a 64-bit processor and operating system
**OS:** Windows 10 version 18362.0 or higher
**Processor:** Intel i5-4460 or AMD Ryzen 3 1200
**Memory:** 8 GB RAM
**Graphics:** NVidia GTX 970, AMD RX 470, OR Intel Arc A380
**Storage:** 110 GB available space
RECOMMENDED:
**Processor:** Intel i5-8400 or AMD Ryzen 5 1500X
**Memory:** 16 GB RAM
**Graphics:** NVidia GTX 1070, AMD RX 590, OR Intel Arc A750
**Storage:** 110 GB available space`;

const fetched = (url = URL_, data = PAGE) => ({
  type: "web_fetch_tool_result", tool_use_id: "srvtoolu_1",
  content: { type: "web_fetch_result", url, content: { type: "document", source: { type: "text", media_type: "text/plain", data }, title: "Forza Horizon 5 on Steam" } },
});
const report = (input: Record<string, unknown>, blocks: unknown[] = [fetched()]): FakeRound => ({ blocks, tool: { name: "report_requirements", input } });
const good = {
  found: true, game: "Forza Horizon 5", url: URL_,
  minimum: { os: "Windows 10 version 18362.0 or higher", cpu: "Intel i5-4460 or AMD Ryzen 3 1200", gpu: "NVidia GTX 970, AMD RX 470, OR Intel Arc A380", memoryGb: 8, storageGb: 110 },
  recommended: { cpu: "Intel i5-8400 or AMD Ryzen 5 1500X", gpu: "NVidia GTX 1070, AMD RX 590, OR Intel Arc A750", memoryGb: 16, storageGb: 110 },
};

async function lookup(rounds: FakeRound[], env = {}) {
  const claude = fakeClaude(rounds);
  const t = await setup(env, claude.client);
  const cookie = await t.signUp("ana@example.com");
  const ask = (game: string, who: string | undefined = cookie) => t.call("/api/games/requirements", { method: "POST", json: { game }, cookie: who });
  const read = async (game: string, who?: string) => ((await (await ask(game, who)).json()) as { requirements: GameRequirements | null }).requirements;
  return { ...t, ...claude, cookie, ask, read };
}

describe("a game's requirements", () => {
  it("keeps the lines Claude copied from a page it fetched, and shares them between accounts", async () => {
    const t = await lookup([report(good)]);
    const r = await t.read("forza horizon 5");
    expect(r).toMatchObject({
      game: "Forza Horizon 5", source: { url: URL_, label: "Steam store page" },
      minimum: { cpu: "Intel i5-4460 or AMD Ryzen 3 1200", memoryGb: 8, storageGb: 110 },
      recommended: { gpu: "NVidia GTX 1070, AMD RX 590, OR Intel Arc A750", memoryGb: 16 },
    });
    expect(t.seen[0].tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "web_fetch_20260209" }),
      expect.objectContaining({ name: "report_requirements" }),
    ]));
    // The same game in other words, from another account, comes from what was read.
    const other = await t.signUp("bo@example.com");
    expect((await t.read("Forza-Horizon 5", other))?.game).toBe("Forza Horizon 5");
    expect(t.seen).toHaveLength(1);
  });

  it("sends back a line that isn't on the page, and keeps the corrected report", async () => {
    const t = await lookup([
      report({ ...good, minimum: { ...good.minimum, gpu: "NVIDIA GeForce GTX 970 4 GB" } }),
      report({ ...good, minimum: { ...good.minimum, memoryGb: 12 } }, []),
      report(good, []),
    ]);
    expect((await t.read("Forza Horizon 5"))?.minimum?.gpu).toBe("NVidia GTX 970, AMD RX 470, OR Intel Arc A380");
    expect(JSON.stringify(t.seen[1].messages)).toContain("isn't on the page as written");
    expect(JSON.stringify(t.seen[2].messages)).toContain("minimum.memoryGb (12 GB) isn't on the page");
  });

  it("refuses a page Claude didn't fetch, and remembers a game it couldn't find", async () => {
    const t = await lookup([report({ ...good, url: "https://requirements.example.com/forza" }), { tool: { name: "report_requirements", input: { found: false } } }]);
    expect(await t.read("Forza Horizon 5")).toBeNull();
    expect(JSON.stringify(t.seen[1].messages)).toContain("a page you fetched with web_fetch");
    expect(await t.read("Forza Horizon 5")).toBeNull();
    expect(t.seen).toHaveLength(2);
  });

  it("needs an account and a name, and counts a lookup as one of the day's questions", async () => {
    const t = await lookup([report(good), { tool: { name: "report_requirements", input: { found: false } } }], { CHAT_DAILY_LIMIT: "1" });
    expect((await t.ask("Forza Horizon 5", "")).status).toBe(401);
    const bad = await t.ask(" ");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ message: "Type the game's name." });
    expect((await t.ask("Forza Horizon 5")).status).toBe(200);
    // Already read: no question used.
    expect((await t.ask("Forza Horizon 5")).status).toBe(200);
    const over = await t.ask("Another Game");
    expect(over.status).toBe(429);
    expect(((await over.json()) as { message: string }).message).toContain("looking up a game counts as one");
  });
});
