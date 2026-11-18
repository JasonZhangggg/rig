// The manuals API (paths and shapes in packages/core/src/api.ts). Every route
// needs an account, and the PC must be on it, like recordings.

import {
  MANUAL_MAX_BYTES,
  type AddManualRequest, type Manual, type ManualHit,
} from "@rig/core";
import type { AppHono, C } from "./app";
import type { Streamer } from "./chat";
import type { MachineRow } from "./db";
import type { Env } from "./env";
import {
  MISS_DAYS, checkPages, checkTarget, findManualAddress, openPdf, pdfStream, sourceKey, trimSnippet,
  type Fetch, type Found,
} from "./manuals";

export interface ManualDeps {
  validId: (id: string) => boolean;
  machine: (c: C) => Promise<MachineRow | null>;
  notFound: (c: C) => Response;
  now: () => Date;
  claude: (env: Env) => Streamer;
  fetch: Fetch;
  /** Questions (and manual lookups) each account gets per day. */
  dailyLimit: (c: C) => number;
}

const SEARCH_LIMIT = 20;
const SEARCH_MAX = 50;

export function manualRoutes(app: AppHono, d: ManualDeps) {
  const { validId } = d;
  const base = "/api/machines/:id/manuals";
  const noManual = (c: C) => c.json({ message: "That manual isn't on this PC." }, 404);
  const manualOf = async (c: C, m: MachineRow) => {
    const mid = c.req.param("mid")!;
    return validId(mid) ? c.get("store").manual(c.get("user").id, m.id, mid) : null;
  };

  app.get(base, async (c) => {
    const m = await d.machine(c);
    return m ? c.json(await c.get("store").manuals(c.get("user").id, m.id)) : d.notFound(c);
  });

  app.get(`${base}/search`, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const q = (c.req.query("q") ?? "").trim();
    const manualId = c.req.query("manual");
    if (manualId !== undefined && !validId(manualId)) return noManual(c);
    const asked = Number(c.req.query("limit") ?? SEARCH_LIMIT);
    const limit = Number.isFinite(asked) ? Math.min(SEARCH_MAX, Math.max(1, Math.round(asked))) : SEARCH_LIMIT;
    if (!q) return c.json([]);
    const rows = await c.get("store").searchManuals(c.get("user").id, m.id, q, { manualId, limit });
    return c.json(rows.map((r): ManualHit => ({ manualId: r.manualId, title: r.title, part: r.part, page: r.page, snippet: trimSnippet(r.snippet) })));
  });

  // Looks the part's manual up on the maker's site. What was found is shared
  // between accounts; only a lookup that asks Claude counts against the day's questions.
  app.post(`${base}/find`, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const t = checkTarget(await c.req.json().catch(() => null));
    if (typeof t === "string") return c.json({ message: t }, 400);
    const store = c.get("store");
    const user = c.get("user");
    const key = sourceKey(t);
    const cached = await store.manualSource(key);
    let found: Found | null;
    if (cached && "found" in cached) found = cached.found;
    else if (cached && d.now().getTime() - cached.missedAt.getTime() < MISS_DAYS * 864e5) found = null;
    else {
      if (!c.env.ANTHROPIC_API_KEY) return c.json({ message: "Rig can't look up manuals on this server yet. You can add one from a PDF file instead." }, 503);
      const limit = d.dailyLimit(c);
      if (!(await store.useChat(user.id, limit, d.now()))) {
        return c.json({ message: `You've used today's ${limit} questions, and looking up a manual counts as one. It resets at midnight UTC.` }, 429);
      }
      try {
        found = await findManualAddress(d.claude(c.env), d.fetch, t, c.req.raw.signal);
      } catch {
        return c.json({ message: "Rig couldn't look for the manual just now. Try again in a minute." }, 502);
      }
      await store.saveManualSource(key, found, d.now());
    }
    if (!found) return c.json({ manual: null });
    const manual = await store.putManual(user.id, m.id, {
      id: crypto.randomUUID(), part: t.part, kind: t.kind, maker: t.maker, model: t.model,
      title: found.title || `${t.maker} ${t.model} user manual`, url: found.url, host: found.host, source: "found", bytes: found.bytes,
    }, d.now());
    return c.json({ manual });
  });

  // A PDF the person picked on their device. Only its details come here; the file stays there.
  app.post(base, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const body = await c.req.json().catch(() => null) as Partial<AddManualRequest> | null;
    const t = checkTarget(body?.target);
    if (typeof t === "string") return c.json({ message: t }, 400);
    if (typeof body?.name !== "string" || !body.name.trim() || body.name.length > 260) return c.json({ message: "name must be the file's name." }, 400);
    if (typeof body.bytes !== "number" || !Number.isInteger(body.bytes) || body.bytes < 1 || body.bytes > MANUAL_MAX_BYTES) {
      return c.json({ message: `Rig takes manuals up to ${Math.round(MANUAL_MAX_BYTES / 1024 / 1024)} MB.` }, 400);
    }
    const title = t.model.toLowerCase().startsWith(t.maker.toLowerCase()) ? `${t.model} manual` : `${t.maker} ${t.model} manual`;
    const manual: Manual = await c.get("store").putManual(c.get("user").id, m.id, {
      id: crypto.randomUUID(), part: t.part, kind: t.kind, maker: t.maker, model: t.model, title, source: "added", bytes: body.bytes,
    }, d.now());
    return c.json(manual);
  });

  // The maker's PDF, passed through so the app doesn't depend on the maker's
  // site allowing it. The address comes from the database, never the request,
  // and is checked against the maker again before every download.
  app.get(`${base}/:mid/pdf`, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const man = await manualOf(c, m);
    if (!man) return noManual(c);
    if (!man.url) return c.json({ message: "This manual was added from a file, so only the device it was added on has it." }, 404);
    const open = await openPdf(d.fetch, man.maker, man.url, c.req.raw.signal);
    if (!open.ok) {
      return c.json({ message: open.tooBig ? "This manual is bigger than Rig downloads." : `Rig couldn't download this manual from ${man.host}. ${open.reason}` }, 502);
    }
    return new Response(pdfStream(open), {
      headers: { "content-type": "application/pdf", "content-disposition": "inline", "cache-control": "private, max-age=86400" },
    });
  });

  app.put(`${base}/:mid/pages`, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const read = checkPages(await c.req.json().catch(() => null));
    if (typeof read === "string") return c.json({ message: read }, 400);
    const mid = c.req.param("mid");
    const man = validId(mid) ? await c.get("store").saveManualPages(c.get("user").id, m.id, mid, read) : null;
    return man ? c.json(man) : noManual(c);
  });

  app.get(`${base}/:mid/pages/:n`, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const n = Number(c.req.param("n"));
    const mid = c.req.param("mid");
    if (!Number.isInteger(n) || n < 1) return c.json({ message: "The page number must be 1 or more." }, 400);
    const page = validId(mid) ? await c.get("store").manualPage(c.get("user").id, m.id, mid, n) : null;
    return page ? c.json(page) : c.json({ message: "That page hasn't been read." }, 404);
  });

  app.delete(`${base}/:mid`, async (c) => {
    const m = await d.machine(c);
    if (!m) return d.notFound(c);
    const mid = c.req.param("mid");
    const ok = validId(mid) && await c.get("store").removeManual(c.get("user").id, m.id, mid);
    return ok ? c.body(null, 204) : noManual(c);
  });
}
