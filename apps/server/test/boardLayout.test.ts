import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { BoardLayoutReply, Manual, ManualTarget } from "@rig/core";
import type { Streamer } from "../src/chat";
import type { Env } from "../src/env";
import type { Fetch } from "../src/manuals";
import { parseReading } from "../src/boardLayout";
import { fakeClaude, setup, syncPayload } from "./helpers";

afterEach(() => { vi.useRealTimers(); });

const PDF = new TextEncoder().encode("%PDF-1.7\n% a tiny pretend manual\n%%EOF\n");
const BOARD_URL = "https://download-2.msi.com/archive/mnu_exe/mb/PROB650-AWIFI_EN.pdf";
const board: ManualTarget = { part: "board", kind: "motherboard", maker: "MSI", model: "PRO B650-A WIFI", source: "detected" };
/** A real reading of the PRO B650-A WIFI's drawing, as the reader writes it. */
const READ = readFileSync(new URL("../../../packages/core/test/fixtures/layout-msi-pro-b650-a.json", import.meta.url), "utf8");
const image = "iVBORw0KGgo" + "A".repeat(400);
const page = { page: 27, image, mediaType: "image/png", width: 1304, height: 924, text: "Overview of Components CPU_FAN1 JFP1" };
const web: Fetch = async (url) => (url === BOARD_URL ? new Response(PDF, { headers: { "content-type": "application/pdf", "content-length": String(PDF.length) } }) : new Response("no", { status: 404 }));
const found = { tool: { name: "report_manual", input: { found: true, url: BOARD_URL, title: "PRO B650-A WIFI user guide" } } };

async function twoPCs(claude: Streamer, env: Partial<Env> = {}) {
  const t = await setup(env, claude, web);
  const pc = async (email: string) => {
    const cookie = await t.signUp(email);
    const s = await syncPayload();
    const id = s.inventory.machine.id;
    await t.call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie });
    const find = await t.call(`/api/machines/${id}/manuals/find`, { method: "POST", json: board, cookie });
    const manual = ((await find.json()) as { manual: Manual }).manual;
    const get = async (maker = "MSI", model = "PRO B650-A WIFI") => (await t.call(`/api/machines/${id}/board-layout?maker=${encodeURIComponent(maker)}&model=${encodeURIComponent(model)}`, { cookie })).json() as Promise<BoardLayoutReply>;
    const read = (body: unknown = page) => t.call(`/api/machines/${id}/manuals/${manual.id}/layout`, { method: "POST", json: body, cookie });
    return { cookie, id, manual, get, read };
  };
  return { ...t, ana: await pc("ana@example.com"), eve: await pc("eve@example.com") };
}

describe("reading a board's layout from its manual", () => {
  it("reads the drawing once with Opus and shares it with every PC that has the board", async () => {
    const claude = fakeClaude([found, { text: READ }, { text: READ }]);
    const t = await twoPCs(claude.client);
    expect(await t.ana.get()).toEqual({ status: "none" });

    const res = await t.ana.read();
    expect(res.status).toBe(200);
    const got = (await res.json()) as BoardLayoutReply;
    expect(got.status).toBe("done");
    expect(got.layout).toMatchObject({ maker: "MSI", model: "PRO B650-A WIFI", page: 27 });
    expect(got.layout?.reading.items.find((i) => i[0] === "JFP1")).toBeDefined();

    // One find (cached for Eve) and one read, whoever asks and however Windows writes the board.
    expect(claude.seen).toHaveLength(2);
    const p = claude.seen[1].params as Record<string, unknown>;
    expect(p).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" }, fallbacks: "default" });
    expect(JSON.stringify(claude.seen[1].messages)).toContain('"media_type":"image/png"');
    expect(JSON.stringify(claude.seen[1].messages)).toContain("1304 by 924 pixels");
    expect(await t.eve.get("Micro-Star International Co., Ltd.", "PRO B650-A WIFI (MS-7D78)")).toEqual(got);
    expect(((await (await t.eve.read()).json()) as BoardLayoutReply).status).toBe("done");
    expect(claude.seen).toHaveLength(2);
  });

  it("makes a second PC wait for a read already running instead of reading again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const base = fakeClaude([found, { text: READ }]);
    let reads = 0;
    const slow = { beta: { messages: { stream(params: Parameters<Streamer["beta"]["messages"]["stream"]>[0]) {
      const s = base.client.beta.messages.stream(params);
      if (!(params as { tools?: unknown }).tools) {
        reads++;
        return { async *[Symbol.asyncIterator]() { await gate; }, finalMessage: () => s.finalMessage() } as unknown as ReturnType<Streamer["beta"]["messages"]["stream"]>;
      }
      return s;
    } } } } as unknown as Streamer;
    const t = await twoPCs(slow);
    const first = t.ana.read();
    await vi.waitFor(() => expect(reads).toBe(1));
    const second = await t.eve.read();
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ status: "reading" });
    release();
    expect(((await (await first).json()) as BoardLayoutReply).status).toBe("done");
    expect(reads).toBe(1);
  });

  it("remembers a drawing it couldn't read for a week", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const claude = fakeClaude([found, { text: "This page shows the rear panel only." }, { text: READ }]);
    const t = await twoPCs(claude.client);
    expect(await (await t.ana.read()).json()).toEqual({ status: "failed" });
    expect(await (await t.eve.read()).json()).toEqual({ status: "failed" });
    expect(claude.seen).toHaveLength(2);
    vi.setSystemTime(Date.now() + 8 * 864e5);
    expect(((await (await t.eve.read()).json()) as BoardLayoutReply).status).toBe("done");
    expect(claude.seen).toHaveLength(3);
  });

  it("lets the next PC try again when the API itself fails", async () => {
    const base = fakeClaude([found, { text: READ }]);
    let down = true;
    const flaky = { beta: { messages: { stream(params: Parameters<Streamer["beta"]["messages"]["stream"]>[0]) {
      const s = base.client.beta.messages.stream(params);
      if (!(params as { tools?: unknown }).tools && down) {
        down = false;
        return { async *[Symbol.asyncIterator]() { throw new Error("overloaded"); }, finalMessage: () => s.finalMessage() } as unknown as ReturnType<Streamer["beta"]["messages"]["stream"]>;
      }
      return s;
    } } } } as unknown as Streamer;
    const t = await twoPCs(flaky);
    expect((await t.ana.read()).status).toBe(502);
    expect(await t.eve.get()).toEqual({ status: "none" });
    expect(((await (await t.eve.read()).json()) as BoardLayoutReply).status).toBe("done");
  });

  it("only reads a motherboard manual found on the maker's site, and checks the picture", async () => {
    const t = await twoPCs(fakeClaude([found, { text: READ }]).client);
    expect((await t.ana.read({ ...page, page: 0 })).status).toBe(400);
    expect((await t.ana.read({ ...page, mediaType: "image/gif" })).status).toBe(400);
    expect((await t.ana.read({ ...page, image: "not base64 at all!" })).status).toBe(400);
    expect((await t.ana.read({ ...page, width: 9000 })).status).toBe(400);
    const added = await t.call(`/api/machines/${t.ana.id}/manuals`, { method: "POST", json: { target: { ...board, part: "extra:board" }, name: "board.pdf", bytes: 1000 }, cookie: t.ana.cookie });
    const mid = ((await added.json()) as Manual).id;
    expect((await t.call(`/api/machines/${t.ana.id}/manuals/${mid}/layout`, { method: "POST", json: page, cookie: t.ana.cookie })).status).toBe(400);
  });

  it("says so when the server has no Claude key", async () => {
    const t = await twoPCs(fakeClaude([found]).client);
    t.env.ANTHROPIC_API_KEY = undefined;
    expect((await t.ana.read()).status).toBe(503);
  });
});

describe("the reader's answer", () => {
  it("takes the JSON out of the answer and drops what isn't a part", () => {
    const r = parseReading(`Here it is: {"form":"atx","board":[1,2,300,380],"items":[["JFP1","fp",1,2,3,4],["bad","fan",1,2],["X","toaster",1,1,2,2]]} done`);
    expect(r).toEqual({ form: "atx", board: [1, 2, 300, 380], items: [["JFP1", "fp", 1, 2, 3, 4], ["X", "other", 1, 1, 2, 2]] });
    expect(parseReading("no layout here")).toBeNull();
  });
});
