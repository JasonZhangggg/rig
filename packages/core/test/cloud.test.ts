import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudClient, serverDownText, unreachableText, wrongServerText, type ManualTarget } from "../src";

const client = () => new CloudClient({ base: "/api" });

describe("CloudClient when the server is in trouble", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says the server isn't answering instead of passing on a bare 500", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500, statusText: "Internal Server Error" }));
    await expect(client().account()).rejects.toThrow(serverDownText);
    await expect(client().signInEmail("a@b.co", "password1")).rejects.toThrow(serverDownText);
  });

  it("keeps the server's own words when it gives them", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "Invalid email or password" }, { status: 401 }));
    await expect(client().signInEmail("a@b.co", "password1")).rejects.toThrow("Invalid email or password");
  });

  it("says it can't reach the server when the request never got there", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    await expect(client().machines()).rejects.toThrow(unreachableText);
  });

  it("treats a signed-out account as no account, not an error", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "Sign in first." }, { status: 401 }));
    await expect(client().account()).resolves.toBeNull();
  });
});

describe("CloudClient pointed at the wrong address", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } });

  it("says so in plain words instead of a JSON parse error", async () => {
    vi.stubGlobal("fetch", async () => page());
    await expect(client().machines()).rejects.toThrow(wrongServerText);
  });

  it("says so when the desktop starts a browser sign-in", async () => {
    vi.stubGlobal("fetch", async () => page());
    const desktop = new CloudClient({ base: "", token: { get: async () => null, set: async () => {} }, openUrl: () => {} });
    await expect(desktop.signInWithBrowser!()).rejects.toThrow(wrongServerText);
  });
});

describe("CloudClient manuals", () => {
  afterEach(() => vi.unstubAllGlobals());

  const target: ManualTarget = { part: "board", kind: "motherboard", maker: "ASUS", model: "ROG STRIX B650-A GAMING WIFI", source: "detected" };
  const manual = { id: "m 1", machineId: "pc", part: "board", kind: "motherboard", maker: "ASUS", model: "X", title: "X manual", source: "found", indexed: false, diagrams: [], addedAt: "2026-11-18T00:00:00.000Z" };

  /** Answers every request with `answer` and records method, address and body. */
  function server(answer: (url: string) => Response) {
    const seen: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body as string) : undefined });
      return answer(url);
    });
    return seen;
  }

  it("calls the paths in the API", async () => {
    const seen = server((url) => (url.endsWith("/find") ? Response.json({ manual }) : url.includes("/search") ? Response.json([]) : url.endsWith("/manuals") ? Response.json([manual]) : new Response(null, { status: 204 })));
    const c = client();
    expect(await c.manuals("pc 1")).toEqual([manual]);
    expect(await c.findManual!("pc 1", target)).toEqual(manual);
    await c.searchManuals("pc 1", "front panel", { manualId: "m 1", limit: 5 });
    await c.searchManuals("pc 1", "F_PANEL");
    await c.removeManual("pc 1", "m 1");
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET /api/machines/pc%201/manuals",
      "POST /api/machines/pc%201/manuals/find",
      "GET /api/machines/pc%201/manuals/search?q=front%20panel&manual=m%201&limit=5",
      "GET /api/machines/pc%201/manuals/search?q=F_PANEL",
      "DELETE /api/machines/pc%201/manuals/m%201",
    ]);
    expect(seen[1].body).toEqual(target);
  });

  it("sends an added file's details and the pages read, and reads one page back", async () => {
    const seen = server((url) => (url.endsWith("/pages/3") ? Response.json({ message: "That page hasn't been read." }, { status: 404 }) : url.endsWith("/pages/2") ? Response.json({ n: 2, text: "two" }) : Response.json(manual)));
    const c = client();
    await c.addManualFile("pc", target, { name: "board.pdf", bytes: 1234 });
    await c.saveManualPages("pc", "m1", [{ n: 1, text: "one" }], [{ page: 1, kind: "board-layout", label: "Board layout" }]);
    expect(await c.manualPage("pc", "m1", 2)).toEqual({ n: 2, text: "two" });
    expect(await c.manualPage("pc", "m1", 3)).toBeNull();
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST /api/machines/pc/manuals",
      "PUT /api/machines/pc/manuals/m1/pages",
      "GET /api/machines/pc/manuals/m1/pages/2",
      "GET /api/machines/pc/manuals/m1/pages/3",
    ]);
    expect(seen[0].body).toEqual({ target, name: "board.pdf", bytes: 1234 });
    expect(seen[1].body).toEqual({ pages: [{ n: 1, text: "one" }], diagrams: [{ page: 1, kind: "board-layout", label: "Board layout" }] });
  });

  it("downloads the PDF's bytes, and passes on the server's reason when it can't", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7");
    server(() => new Response(pdf, { headers: { "content-type": "application/pdf" } }));
    const buf = await client().manualFile("pc", "m1");
    expect(new Uint8Array(buf)).toEqual(pdf);
    server(() => Response.json({ message: "This manual was added from a file, so only the device it was added on has it." }, { status: 404 }));
    await expect(client().manualFile("pc", "m1")).rejects.toThrow(/added from a file/);
  });
});
