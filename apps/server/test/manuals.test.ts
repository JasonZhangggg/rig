import { afterEach, describe, expect, it, vi } from "vitest";
import { MANUAL_MAX_BYTES, manualLink, type ChatEvent, type Manual, type ManualHit, type ManualPage, type ManualTarget } from "@rig/core";
import { addressProblem, checkPages, makerHost, sourceKey, trimSnippet } from "../src/manuals";
import type { Fetch } from "../src/manuals";
import type { Env } from "../src/env";
import { fakeClaude, readEvents, setup, syncPayload } from "./helpers";

afterEach(() => { vi.useRealTimers(); });

describe("which sites a manual may come from", () => {
  it("takes a known maker's own domain and its subdomains, and nothing that only looks like it", () => {
    expect(makerHost("ASUS", "asus.com")).toBe(true);
    expect(makerHost("ASUS", "dlcdnets.asus.com")).toBe(true);
    expect(makerHost("ROG", "rog.asus.com")).toBe(true);
    expect(makerHost("ASUSTeK COMPUTER INC.", "dlcdnets.asus.com")).toBe(true);
    expect(makerHost("ASUS", "asus.com.evil.net")).toBe(false);
    expect(makerHost("ASUS", "notasus.com")).toBe(false);
    expect(makerHost("ASUS", "asus.co")).toBe(false);
    expect(makerHost("ASUS", "msi.com")).toBe(false);
    expect(makerHost("Gigabyte", "download.gigabyte.com")).toBe(true);
    expect(makerHost("AORUS", "download.gigabyte.com")).toBe(true);
    expect(makerHost("Gigabyte Technology Co., Ltd.", "gigabyte.com")).toBe(true);
    expect(makerHost("Micro-Star International Co., Ltd.", "download.msi.com")).toBe(true);
    expect(makerHost("Western Digital", "documents.westerndigital.com")).toBe(true);
    expect(makerHost("WD", "wdc.com")).toBe(true);
    expect(makerHost("be quiet!", "www.bequiet.com")).toBe(true);
    expect(makerHost("G.SKILL", "gskill.com")).toBe(true);
    expect(makerHost("Lian Li", "lian-li.com")).toBe(true);
    expect(makerHost("Lian Li", "lianli.com")).toBe(false);
    expect(makerHost("Framework", "frame.work")).toBe(true);
    expect(makerHost("Noctua", "noctua.at")).toBe(true);
    expect(makerHost("Noctua", "noctua.com")).toBe(false);
  });

  it("for a maker Rig doesn't know, wants the maker's name in the site's own name", () => {
    expect(makerHost("Montech", "montech.com")).toBe(true);
    expect(makerHost("Montech", "download.montechpc.com")).toBe(true);
    expect(makerHost("Montech", "www.montech.com.tw")).toBe(true);
    expect(makerHost("Montech", "montech.com.evil.net")).toBe(false);
    expect(makerHost("Montech", "evil.net")).toBe(false);
    expect(makerHost("Montech", "com.tw")).toBe(false);
    expect(makerHost("XY", "xy.com")).toBe(false);
    expect(makerHost("Montech", "10.0.0.1")).toBe(false);
  });

  it("wants https, no user name or port, and the host to be the maker's", () => {
    expect(addressProblem("ASUS", "https://dlcdnets.asus.com/pub/m.pdf")).toBeNull();
    expect(addressProblem("ASUS", "http://dlcdnets.asus.com/pub/m.pdf")).toMatch(/https/);
    expect(addressProblem("ASUS", "https://dlcdnets.asus.com:8443/m.pdf")).toMatch(/port/);
    expect(addressProblem("ASUS", "https://asus.com@evil.net/m.pdf")).toMatch(/user name/);
    expect(addressProblem("ASUS", "https://evil.net/asus.com/m.pdf")).toMatch(/evil.net isn't ASUS's own site \(asus.com\)/);
    expect(addressProblem("ASUS", "file:///etc/passwd")).toMatch(/https/);
    expect(addressProblem("ASUS", "not a url")).toMatch(/web address/);
  });

  it("shares one cache entry between ways of writing the same maker and model", () => {
    const a = sourceKey({ kind: "motherboard", maker: "ASUS", model: "ROG STRIX B650-A GAMING WIFI" });
    expect(sourceKey({ kind: "motherboard", maker: "ASUSTeK COMPUTER INC.", model: "rog strix  b650-a gaming wifi" })).toBe(a);
    expect(sourceKey({ kind: "gpu", maker: "ASUS", model: "ROG STRIX B650-A GAMING WIFI" })).not.toBe(a);
  });
});

describe("page text from the app", () => {
  it("cuts pages to size, drops NULs and checks the diagrams", () => {
    const r = checkPages({ pages: [{ n: 2, text: "x".repeat(7000) }, { n: 1, text: "a\u0000b" }, { n: 700, text: "late" }], diagrams: [{ page: 2, kind: "front-panel" }, { page: 2, kind: "front-panel", label: "again" }] });
    if (typeof r === "string") throw new Error(r);
    expect(r.pageCount).toBe(700);
    expect(r.pages.map((p) => [p.n, p.text.length])).toEqual([[1, 2], [2, 6000]]);
    expect(r.pages[0].text).toBe("ab");
    expect(r.diagrams).toEqual([{ page: 2, kind: "front-panel", label: "Front panel header" }]);
    expect(checkPages({ pages: [{ n: 1, text: "a" }], diagrams: [{ page: 1, kind: "cat-photos" }] })).toMatch(/kind must be one of/);
    expect(checkPages({ pages: [{ n: 1, text: "a" }], diagrams: [{ page: 5, kind: "specs" }] })).toMatch(/page number from 1 to 1/);
    expect(checkPages({ pages: [{ n: 0, text: "a" }], diagrams: [] })).toMatch(/page number/);
    expect(checkPages({ pages: "nope" })).toMatch(/pages must be/);
  });

  it("keeps snippets short with their marks paired", () => {
    const s = trimSnippet(`${"word ".repeat(60)}«match» end`, 100);
    expect(s.length).toBeLessThanOrEqual(102);
    expect(s.endsWith("…")).toBe(true);
    expect(trimSnippet(`${"w".repeat(90)}«matchingwordthatgoeson»`, 100)).toMatch(/«match\w*»…$/);
  });
});

// ----- The API -----

const PDF = new TextEncoder().encode("%PDF-1.7\n% a tiny pretend manual\n%%EOF\n");
const BOARD_URL = "https://dlcdnets.asus.com/pub/ASUS/mb/E21369_ROG_STRIX_B650-A_GAMING_WIFI_UM.pdf";
const board: ManualTarget = { part: "board", kind: "motherboard", maker: "ASUS", model: "ROG STRIX B650-A GAMING WIFI", source: "detected" };

/** A pretend internet: each address answers as told. Records every address asked for. */
function fakeWeb(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetch: Fetch = async (url) => {
    asked.push(url);
    const r = routes[url];
    return r ? r() : new Response("not found", { status: 404 });
  };
  return { fetch, asked, routes };
}
const pdfAt = () => new Response(PDF, { headers: { "content-type": "application/pdf", "content-length": String(PDF.length) } });

const report = (input: Record<string, unknown>) => ({ tool: { name: "report_manual", input } });

async function manualSetup(rounds: Parameters<typeof fakeClaude>[0], routes: Record<string, () => Response> = { [BOARD_URL]: pdfAt }, env: Partial<Env> = {}) {
  const claude = fakeClaude(rounds);
  const web = fakeWeb(routes);
  const t = await setup(env, claude.client, web.fetch);
  const cookie = await t.signUp("ana@example.com");
  const s = await syncPayload();
  const id = s.inventory.machine.id;
  await t.call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie });
  const base = `/api/machines/${id}/manuals`;
  const find = async (target: ManualTarget = board, who = cookie) => t.call(`${base}/find`, { method: "POST", json: target, cookie: who });
  const found = async (target: ManualTarget = board) => ((await (await find(target)).json()) as { manual: Manual | null }).manual;
  const list = async () => (await t.call(base, { cookie })).json() as Promise<Manual[]>;
  const save = (mid: string, pages: ManualPage[], diagrams: unknown[] = []) => t.call(`${base}/${mid}/pages`, { method: "PUT", json: { pages, diagrams }, cookie });
  const search = async (q: string, extra = "") => (await t.call(`${base}/search?q=${encodeURIComponent(q)}${extra}`, { cookie })).json() as Promise<ManualHit[]>;
  const addFile = (target: ManualTarget, name = "manual.pdf", bytes = 1_000_000) => t.call(base, { method: "POST", json: { target, name, bytes }, cookie });
  return { ...t, ...claude, web, cookie, s, id, base, find, found, list, save, search, addFile };
}

/** A few pages that read like a motherboard manual. */
const boardPages: ManualPage[] = [
  { n: 1, text: "ROG STRIX B650-A GAMING WIFI user guide. Contents: specifications, board layout, connectors, BIOS." },
  { n: 12, text: "Motherboard layout. CPU_FAN, CPU_OPT, CHA_FAN1, AIO_PUMP, F_PANEL, JRGB1, ADD_GEN2, M2_1, M2_2, 24-pin EATXPWR, 8-pin EATX12V." },
  { n: 23, text: "System panel header. Connect the front panel switches and LEDs of your case to the F_PANEL header: power switch (PWR_SW), reset switch (RESET_SW), power LED (PLED) and hard disk activity LED (HDD_LED). Check the + and - marks." },
  { n: 30, text: "Recommended memory configuration. With two modules, install them in DIMM_A2 and DIMM_B2 first for the best performance." },
  { n: 41, text: "Fan headers. CPU_FAN supports a CPU fan of up to 1 A (12 W). Connecting the fans: plug each fan cable into a fan header." },
];

describe("finding a manual", () => {
  it("asks Claude with web search, checks the address is the maker's PDF and adds it unread", async () => {
    const { found, list, seen, web } = await manualSetup([report({ found: true, url: BOARD_URL, title: "ROG STRIX B650-A GAMING WIFI user manual" })]);
    const m = await found();
    expect(m).toMatchObject({ part: "board", kind: "motherboard", maker: "ASUS", title: "ROG STRIX B650-A GAMING WIFI user manual", url: BOARD_URL, host: "dlcdnets.asus.com", source: "found", indexed: false, diagrams: [], bytes: PDF.length });
    expect(await list()).toEqual([m]);
    expect(web.asked).toEqual([BOARD_URL]);

    const p = seen[0].params as Record<string, unknown>;
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "low" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(p.tool_choice).toBeUndefined();
    expect(p.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "web_search_20260209", max_uses: 5 }),
      expect.objectContaining({ type: "web_fetch_20260209", max_uses: 3 }),
      expect.objectContaining({ name: "report_manual", eager_input_streaming: true }),
    ]));
    expect(JSON.stringify(seen[0].messages)).toContain("Model: ROG STRIX B650-A GAMING WIFI");
    expect(JSON.stringify(seen[0].messages)).toContain("asus.com");
  });

  it("refuses an address off the maker's site, tells Claude why, and says nothing was found", async () => {
    const { found, list, seen, web } = await manualSetup([
      report({ found: true, url: "https://asus.com.evil.net/manual.pdf" }),
      report({ found: false }),
    ], { "https://asus.com.evil.net/manual.pdf": pdfAt });
    expect(await found()).toBeNull();
    expect(web.asked).toEqual([]);
    expect(JSON.stringify(seen[1].messages)).toContain("asus.com.evil.net isn't ASUS's own site");
    expect(await list()).toEqual([]);
  });

  it("refuses a maker page that isn't a PDF, and a redirect that leaves the maker's site", async () => {
    const page = "https://www.asus.com/support/download-center/";
    const hop = "https://dlcdnets.asus.com/redirect/manual.pdf";
    const { found, seen, web } = await manualSetup([
      report({ found: true, url: page }),
      report({ found: true, url: hop }),
      report({ found: true, url: BOARD_URL, title: "The manual" }),
    ], {
      [page]: () => new Response("<!doctype html><html>Downloads</html>", { headers: { "content-type": "text/html" } }),
      [hop]: () => new Response(null, { status: 302, headers: { location: "https://files.evil.net/manual.pdf" } }),
      [BOARD_URL]: pdfAt,
    });
    expect((await found())?.url).toBe(BOARD_URL);
    expect(JSON.stringify(seen[1].messages)).toContain("isn't a PDF file");
    expect(JSON.stringify(seen[2].messages)).toContain("files.evil.net isn't ASUS's own site");
    expect(web.asked).toEqual([page, hop, BOARD_URL]);
  });

  it("follows a redirect within the maker's site and keeps the final address", async () => {
    const hop = "https://www.asus.com/manual/b650a";
    const { found } = await manualSetup([report({ found: true, url: hop })], {
      [hop]: () => new Response(null, { status: 301, headers: { location: BOARD_URL } }),
      [BOARD_URL]: pdfAt,
    });
    expect(await found()).toMatchObject({ url: BOARD_URL, host: "dlcdnets.asus.com", title: "ASUS ROG STRIX B650-A GAMING WIFI user manual" });
  });

  it("remembers what it found for everyone, and what it couldn't find for a week", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await manualSetup([
      report({ found: true, url: BOARD_URL, title: "Board manual" }),
      report({ found: false }),
      report({ found: false }),
    ]);
    expect((await t.found())?.url).toBe(BOARD_URL);
    expect(t.seen).toHaveLength(1);

    // Another account with the same board, written differently: no second search.
    const other = await t.signUp("eve@example.com");
    await t.call(`/api/machines/${t.id}/sync`, { method: "PUT", json: t.s, cookie: other });
    const res = await t.find({ ...board, maker: "ASUSTeK COMPUTER INC.", model: "rog strix b650-a gaming wifi" }, other);
    expect(((await res.json()) as { manual: Manual }).manual).toMatchObject({ url: BOARD_URL, title: "Board manual" });
    expect(t.seen).toHaveLength(1);

    const psu: ManualTarget = { part: "extra:psu", kind: "psu", maker: "Corsair", model: "RM850x", source: "added" };
    expect(await t.found(psu)).toBeNull();
    expect(await t.found(psu)).toBeNull();
    expect(t.seen).toHaveLength(2);
    vi.setSystemTime(Date.now() + 8 * 864e5);
    expect(await t.found(psu)).toBeNull();
    expect(t.seen).toHaveLength(3);
  });

  it("counts a lookup that asks Claude against the day's questions, but not one from the cache", async () => {
    const t = await manualSetup([report({ found: true, url: BOARD_URL })], undefined, { CHAT_DAILY_LIMIT: "1" });
    expect((await t.find()).status).toBe(200);
    const gpu: ManualTarget = { part: "gpu", kind: "gpu", maker: "MSI", model: "GeForce RTX 4070 VENTUS 2X", source: "detected" };
    const over = await t.find(gpu);
    expect(over.status).toBe(429);
    expect(((await over.json()) as { message: string }).message).toMatch(/looking up a manual counts as one/);
    expect((await t.find()).status).toBe(200);
    expect(t.seen).toHaveLength(1);
  });

  it("says so when the server has no Claude key, and checks the part", async () => {
    const t = await manualSetup([report({ found: false })], undefined, { ANTHROPIC_API_KEY: undefined });
    expect((await t.find()).status).toBe(503);
    expect((await t.find({ ...board, kind: "toaster" as never })).status).toBe(400);
    expect((await t.find({ ...board, model: "  " })).status).toBe(400);
    expect((await t.find({ ...board, part: "../../etc" })).status).toBe(400);
  });
});

describe("a manual's PDF", () => {
  it("passes the maker's PDF through", async () => {
    const t = await manualSetup([report({ found: true, url: BOARD_URL })]);
    const m = (await t.found())!;
    const res = await t.call(`${t.base}/${m.id}/pdf`, { cookie: t.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  it("refuses what isn't a PDF, or is too big, when it's downloaded later", async () => {
    const t = await manualSetup([report({ found: true, url: BOARD_URL })]);
    let m = (await t.found())!;
    const pdf = () => t.call(`${t.base}/${m.id}/pdf`, { cookie: t.cookie });

    t.web.routes[BOARD_URL] = () => new Response("<html>moved</html>", { headers: { "content-type": "text/html" } });
    const html = await pdf();
    expect(html.status).toBe(502);
    expect(((await html.json()) as { message: string }).message).toMatch(/isn't a PDF/);
    // The shared cache forgets that address, so the next lookup searches again.
    t.web.routes[BOARD_URL] = pdfAt;
    expect(t.seen).toHaveLength(1);
    m = (await t.found())!;
    expect(t.seen).toHaveLength(2);

    t.web.routes[BOARD_URL] = () => new Response(PDF, { headers: { "content-length": String(MANUAL_MAX_BYTES + 1) } });
    const big = await pdf();
    expect(big.status).toBe(502);
    expect(((await big.json()) as { message: string }).message).toMatch(/bigger than Rig downloads/);

    // No content-length: it stops once the download passes the limit.
    const chunk = new Uint8Array(8 * 1024 * 1024);
    t.web.routes[BOARD_URL] = () => {
      let sent = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(c) {
          if (sent === 0) { c.enqueue(PDF); sent += PDF.length; return; }
          if (sent > MANUAL_MAX_BYTES * 2) { c.close(); return; }
          c.enqueue(chunk); sent += chunk.length;
        },
      }));
    };
    const endless = await pdf();
    expect(endless.status).toBe(200);
    await expect(endless.arrayBuffer()).rejects.toThrow();
  });

  it("re-checks the stored address against the maker before downloading", async () => {
    const t = await manualSetup([report({ found: true, url: BOARD_URL })]);
    const m = (await t.found())!;
    // As if the row had been changed to point elsewhere.
    await t.db.updateTable("manuals").set({ url: "https://evil.net/manual.pdf" }).where("id", "=", m.id).execute();
    t.web.asked.length = 0;
    const res = await t.call(`${t.base}/${m.id}/pdf`, { cookie: t.cookie });
    expect(res.status).toBe(502);
    expect(t.web.asked).toEqual([]);
  });

  it("has no PDF for a file the person added", async () => {
    const t = await manualSetup([]);
    const m = await (await t.addFile({ part: "extra:case", kind: "case", maker: "Fractal Design", model: "North", source: "added" }, "North-manual.pdf", 4_000_000)).json() as Manual;
    expect(m).toMatchObject({ source: "added", title: "Fractal Design North manual", bytes: 4_000_000, indexed: false });
    expect(m.url).toBeUndefined();
    const res = await t.call(`${t.base}/${m.id}/pdf`, { cookie: t.cookie });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).toMatch(/added from a file/);
    expect((await t.addFile({ ...board }, "x.pdf", MANUAL_MAX_BYTES + 1)).status).toBe(400);
    expect((await t.addFile({ ...board }, "", 10)).status).toBe(400);
  });
});

describe("reading and searching manuals", () => {
  async function withPages() {
    const t = await manualSetup([report({ found: true, url: BOARD_URL, title: "ROG STRIX B650-A GAMING WIFI user manual" })]);
    const m = (await t.found())!;
    const res = await t.save(m.id, boardPages, [{ page: 12, kind: "board-layout", label: "Board layout" }, { page: 23, kind: "front-panel" }, { page: 41, kind: "fan-headers" }]);
    expect(res.status).toBe(200);
    return { ...t, m: await res.json() as Manual };
  }

  it("saves the pages, marks the manual read and lists its diagram pages", async () => {
    const { m, list, call, base, cookie } = await withPages();
    expect(m).toMatchObject({ indexed: true, pageCount: 41, diagrams: [{ page: 12, kind: "board-layout" }, { page: 23, kind: "front-panel", label: "Front panel header" }, { page: 41, kind: "fan-headers" }] });
    expect((await list())[0]).toEqual(m);
    expect(await (await call(`${base}/${m.id}/pages/23`, { cookie })).json()).toEqual(boardPages[2]);
    expect((await call(`${base}/${m.id}/pages/2`, { cookie })).status).toBe(404);
    expect((await call(`${base}/${m.id}/pages/zero`, { cookie })).status).toBe(400);
  });

  it("finds pages from a plain question and from header names, best first", async () => {
    const { search, m } = await withPages();
    const prose = await search("how do I connect the front panel");
    expect(prose[0]).toMatchObject({ manualId: m.id, page: 23, part: "board", title: "ROG STRIX B650-A GAMING WIFI user manual" });
    expect(prose[0].snippet).toMatch(/«front» «panel»/);
    expect(prose[0].snippet.length).toBeLessThanOrEqual(225);

    expect((await search("F_PANEL")).map((h) => h.page).sort()).toEqual([12, 23]);
    expect((await search("CPU_FAN")).map((h) => h.page).sort()).toEqual([12, 41]);
    expect((await search("JRGB1")).map((h) => h.page)).toEqual([12]);
    expect((await search("M2_1")).map((h) => h.page)).toEqual([12]);
    expect((await search("connecting fans"))[0].page).toBe(41);
    expect((await search("DIMM_A2"))[0].page).toBe(30);
    expect(await search("the of and")).toEqual([]);
    expect(await search("   ")).toEqual([]);
    expect(await search("dishwasher")).toEqual([]);
    expect(await search("fan", "&limit=1")).toHaveLength(1);
    expect(await search("F_PANEL", "&manual=someone-elses")).toEqual([]);
    expect(await search("F_PANEL", `&manual=${m.id}`)).toHaveLength(2);
  });

  it("checks page text and diagrams, and takes several megabytes for a long manual", async () => {
    const { save, m, call, base, cookie } = await withPages();
    expect((await save(m.id, boardPages, [{ page: 99, kind: "specs" }])).status).toBe(400);
    expect((await save(m.id, boardPages, [{ page: 1, kind: "selfie" }])).status).toBe(400);
    expect((await save(m.id, [{ n: -1, text: "x" }] as ManualPage[])).status).toBe(400);
    expect((await save("not-a-manual", boardPages)).status).toBe(404);

    const long = Array.from({ length: 650 }, (_, i) => ({ n: i + 1, text: `Page ${i + 1}. ${"Lorem ipsum dolor sit amet. ".repeat(250)}` }));
    const res = await save(m.id, long);
    expect(res.status).toBe(200);
    // Only this route takes that much.
    expect((await call(base, { method: "POST", json: { target: board, name: "x".repeat(3_000_000), bytes: 10 }, cookie })).status).toBe(413);
    expect(await res.json()).toMatchObject({ pageCount: 650, diagrams: [] });
    const p600 = await (await call(`${base}/${m.id}/pages/600`, { cookie })).json() as ManualPage;
    expect(p600.text.length).toBe(6000);
    expect((await call(`${base}/${m.id}/pages/601`, { cookie })).status).toBe(404);
    // The old pages are gone.
    expect(((await (await call(`${base}/${m.id}/pages/23`, { cookie })).json()) as ManualPage).text).toMatch(/^Page 23\. Lorem/);
  });

  it("keeps one manual per part: adding again replaces the old one and its pages", async () => {
    const { addFile, list, search, m } = await withPages();
    const again = await (await addFile({ ...board, source: "added" }, "my-copy.pdf")).json() as Manual;
    const now = await list();
    expect(now.map((x) => x.id)).toEqual([again.id]);
    expect(now[0].id).not.toBe(m.id);
    expect(await search("F_PANEL")).toEqual([]);
  });

  it("removes a manual with its pages", async () => {
    const { call, base, cookie, m, list, search } = await withPages();
    expect((await call(`${base}/${m.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await list()).toEqual([]);
    expect(await search("F_PANEL")).toEqual([]);
    expect((await call(`${base}/${m.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await call(`${base}/${m.id}/pages/23`, { cookie })).status).toBe(404);
  });

  it("keeps manuals private to the account", async () => {
    const { call, signUp, base, m, id, s } = await withPages();
    const eve = await signUp("eve@example.com");
    expect((await call(base, { cookie: eve })).status).toBe(404);
    // Even with the same PC on her account, Ana's manuals aren't hers.
    await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie: eve });
    expect(await (await call(base, { cookie: eve })).json()).toEqual([]);
    expect(await (await call(`${base}/search?q=F_PANEL`, { cookie: eve })).json()).toEqual([]);
    expect((await call(`${base}/${m.id}/pages/23`, { cookie: eve })).status).toBe(404);
    expect((await call(`${base}/${m.id}/pdf`, { cookie: eve })).status).toBe(404);
    expect((await call(`${base}/${m.id}/pages`, { method: "PUT", json: { pages: [{ n: 1, text: "mine now" }], diagrams: [] }, cookie: eve })).status).toBe(404);
    expect((await call(`${base}/${m.id}`, { method: "DELETE", cookie: eve })).status).toBe(404);
    expect((await call(base)).status).toBe(401);
    expect((await call(`/api/machines/someone-elses/manuals/find`, { method: "POST", json: board, cookie: eve })).status).toBe(404);
  });
});

describe("the chat and manuals", () => {
  it("searches the read manual and cites the page as a link into Rig", async () => {
    const t = await manualSetup([
      report({ found: true, url: BOARD_URL, title: "ROG STRIX B650-A GAMING WIFI user manual" }),
      { tool: { name: "search_manuals", input: { query: "front panel header", part: "motherboard" } } },
      { text: "Page 23 of your board manual shows the F_PANEL header." },
    ]);
    const m = (await t.found())!;
    await t.save(m.id, boardPages, [{ page: 23, kind: "front-panel" }]);
    const res = await t.call("/api/chat", { method: "POST", json: { machineId: t.id, messages: [{ from: "you", text: "Where do the case's power button wires go?" }] }, cookie: t.cookie });
    const events = await readEvents(res);

    const system = JSON.stringify(t.seen[1].system);
    expect(system).toContain("search_manuals first");
    expect(system).toContain(`\\"id\\":\\"${m.id}\\"`);
    expect(system).toContain("Front panel header, page 23");
    expect(t.seen[1].tools.map((x) => (x as { name: string }).name)).toContain("search_manuals");

    const told = JSON.stringify(t.seen[2].messages.at(-1));
    expect(told).toContain("ROG STRIX B650-A GAMING WIFI user manual, page 23");
    expect(told).toContain("PWR_SW");

    const sources = (events.find((e) => e.type === "sources") as Extract<ChatEvent, { type: "sources" }>).sources;
    expect(sources[1]).toEqual({ label: "ROG STRIX B650-A GAMING WIFI manual, page 23", kind: "Manual", url: manualLink(m.id, 23) });
    expect(sources[1].url).toBe(`rig:manual/${m.id}#page=23`);
  });

  it("tells the model when no manual has been read yet", async () => {
    const t = await manualSetup([{ tool: { name: "search_manuals", input: { query: "F_PANEL" } } }, { text: "ok" }]);
    await readEvents(await t.call("/api/chat", { method: "POST", json: { machineId: t.id, messages: [{ from: "you", text: "Front panel?" }] }, cookie: t.cookie }));
    expect(JSON.stringify(t.seen[1].messages.at(-1))).toContain("add the manual on the Manuals page");
  });
});
