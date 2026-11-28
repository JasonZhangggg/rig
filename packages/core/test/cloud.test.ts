import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudClient, serverDownText, unreachableText, wrongServerText, type ChatEvent, type ManualTarget } from "../src";

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

  it("gives up on a server that never starts answering", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const done = expect(client().machines()).rejects.toThrow(unreachableText);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    vi.useRealTimers();
  });

  it("logs each request's status and timing without its ids", async () => {
    const lines: string[] = [];
    vi.stubGlobal("fetch", async () => Response.json([]));
    await new CloudClient({ base: "/api", log: (level, msg) => lines.push(`${level} ${msg}`) }).machines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^info server: GET \/machines 200 in \d+ ms$/);
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

describe("CloudClient chat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends each answer's seal back, and reads a proposal from an older server as fix steps", async () => {
    const sent: unknown[] = [];
    const proposal = { id: "p1", title: "Turn on Game Mode", rows: [], status: "waiting", calls: [{ kind: "windows.gameMode", enabled: true }] };
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(`data: ${JSON.stringify({ type: "proposal", proposal })}\n\ndata: {"type":"done"}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const events: ChatEvent[] = [];
    await client().chat("pc", [{ id: "1", from: "you", text: "Hi" }, { id: "2", from: "rig", text: "Hello.", seal: "s1", sources: [] }, { id: "3", from: "you", text: "Faster?" }], (e) => events.push(e));
    expect((sent[0] as { messages: unknown[] }).messages).toEqual([{ from: "you", text: "Hi" }, { from: "rig", text: "Hello.", seal: "s1" }, { from: "you", text: "Faster?" }]);
    // The chat's id is its first question's, so the server can bind each answer's seal to this chat.
    expect((sent[0] as { chatId?: string }).chatId).toBe("1");
    const p = (events[0] as Extract<ChatEvent, { type: "proposal" }>).proposal;
    expect(p.steps).toEqual([{ kind: "fix", call: { kind: "windows.gameMode", enabled: true } }]);
    expect(p.tier).toBe(1);
  });
});

describe("CloudClient on a website tab", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("stops asking for a PC while the tab is in the background, and catches up when it's shown", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { asked.push(url); return Response.json(url.endsWith("/recordings") ? [] : { id: "pc1" }); });
    const page = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    page.visibilityState = "visible";
    vi.stubGlobal("document", page);
    const views: unknown[] = [];
    const stop = client().watch("pc1", (pc) => views.push(pc));
    const stopRecs = client().watchRecordings("pc1", () => {});
    await vi.advanceTimersByTimeAsync(31_000);
    expect(asked).toHaveLength(6);

    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(asked).toHaveLength(6);

    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(8);
    expect(views).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(asked).toHaveLength(10);

    stop(); stopRecs();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(10);
  });
});
