// Rig's own tables: the PCs on each account, their temperature history and
// chat use. Better Auth keeps its own tables (user, session, account, …) in
// the same database.

import { sql, type Selectable } from "kysely";
import {
  changeOf, cleanEvents, isActive, makeExport, newRecording, toInfo, toRequest,
  type Change, type DataExport, type StoredChange, type Game, type HistoryPoint, type Identity, type Inventory, type MachineSync, type Manual, type ManualDiagram,
  type ManualKind, type ManualPage, type PC, type PCEvent, type Recording, type RecordingInfo, type RecordingRequest, type SystemFacts,
} from "@rig/core";
import type { Found } from "./manuals";
import type { DB, RigTables } from "./sql";

const HISTORY_DAYS = 30;
/** The desktop sends at most this many points per sync. */
const HISTORY_MAX = 2000;
const GAME_NAME_MAX = 120;
/** A PC counts as online when it synced this recently. The desktop syncs every 5 minutes. */
const ONLINE_MS = 12 * 60_000;
/** Recordings kept per PC, and for how long. */
const RECORDINGS_MAX = 20;
const RECORDINGS_DAYS = 90;
/** A request the PC never picked up gives up after this long. */
const PENDING_MS = 24 * 3600_000;

export interface MachineRow {
  id: string;
  view: PC;
  inventory: Inventory | null;
  facts: SystemFacts | null;
  changes: Change[];
  games: Game[];
  identity: Identity;
  identityAt: string | null;
  syncedAt: string;
  events: PCEvent[];
}

type Row = Selectable<RigTables["machine"]>;

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
/** A reading as a whole number, or null when it's missing or isn't a finite number. */
const whole = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

function fromRow(r: Row): MachineRow {
  return {
    id: r.id, view: r.view as PC, inventory: (r.inventory as Inventory | null) ?? null, facts: (r.facts as SystemFacts | null) ?? null,
    changes: ((r.changes as StoredChange[] | null) ?? []).map(changeOf), games: (r.games as Game[]) ?? [], identity: (r.identity as Identity) ?? {},
    identityAt: iso(r.identity_at), syncedAt: iso(r.synced_at)!, events: (r.events as PCEvent[]) ?? [],
  };
}

/** The view the website shows: the PC's last upload with the account's name and color on top. */
export function present(m: MachineRow, now = Date.now()): PC {
  const seen = Date.parse(m.syncedAt);
  const id = Object.fromEntries(Object.entries(m.identity).filter(([, v]) => v != null)) as Identity;
  return { ...m.view, ...id, id: m.id, lastSync: m.syncedAt, seenAt: m.view.seenAt ?? m.syncedAt, online: now - seen < ONLINE_MS };
}

function toManual(r: Selectable<RigTables["manuals"]>): Manual {
  return {
    id: r.id, machineId: r.machine_id, part: r.part, kind: r.kind as ManualKind, maker: r.maker, model: r.model, title: r.title,
    ...(r.url ? { url: r.url, host: r.host ?? new URL(r.url).hostname } : {}),
    source: r.source === "added" ? "added" : "found",
    ...(r.page_count != null ? { pageCount: r.page_count } : {}),
    indexed: r.indexed, diagrams: (r.diagrams as ManualDiagram[]) ?? [], addedAt: iso(r.added_at)!,
    ...(r.bytes != null ? { bytes: r.bytes } : {}),
  };
}

/** A page that matched a search, with its text and a snippet around the match. */
export interface PageMatch { manualId: string; title: string; model: string; part: string; page: number; text: string; snippet: string }

function withData(r: { info: unknown; data: unknown }): Recording {
  const data = (r.data ?? {}) as Partial<Pick<Recording, "samples" | "events">>;
  return { ...(r.info as RecordingInfo), samples: data.samples ?? [], events: data.events ?? [] };
}

export type BoardLayoutRow = Omit<Selectable<RigTables["board_layouts"]>, "started_at" | "updated_at"> & { started_at: Date; updated_at: Date };

export class Store {
  constructor(private db: DB) {}

  async machines(userId: string): Promise<MachineRow[]> {
    const rows = await this.db.selectFrom("machine").selectAll().where("user_id", "=", userId).orderBy("synced_at", "desc").execute();
    return rows.map(fromRow);
  }

  async machine(userId: string, id: string): Promise<MachineRow | null> {
    const r = await this.db.selectFrom("machine").selectAll().where("user_id", "=", userId).where("id", "=", id).executeTakeFirst();
    return r ? fromRow(r) : null;
  }

  /** Saves an upload. The identity changed most recently, here or on the web, wins. */
  async sync(userId: string, id: string, s: MachineSync, now = new Date()): Promise<{ identity: Identity; identityAt?: string; recordings: { start: RecordingRequest[]; stop: string[] } }> {
    return this.db.transaction().execute(async (trx) => {
      const old = await new Store(trx).machine(userId, id);
      const keepOld = old?.identityAt && (!s.identityAt || Date.parse(old.identityAt) >= Date.parse(s.identityAt));
      const identity = keepOld ? old!.identity : s.identity ?? {};
      const identityAt = keepOld ? old!.identityAt! : s.identityAt ? new Date(s.identityAt).toISOString() : null;
      const values = {
        view: JSON.stringify(s.view), inventory: JSON.stringify(s.inventory), facts: JSON.stringify(s.facts),
        changes: JSON.stringify(s.changes.slice(0, 200)), games: JSON.stringify(s.games),
        identity: JSON.stringify(identity), identity_at: identityAt, synced_at: now,
        // Apps from before Rig read the event log send none; keep what's there.
        ...(s.events ? { events: JSON.stringify(cleanEvents(s.events)) } : {}),
      };
      await trx.insertInto("machine").values({ user_id: userId, id, ...values })
        .onConflict((oc) => oc.columns(["user_id", "id"]).doUpdateSet(values)).execute();
      const points = s.history.slice(-HISTORY_MAX).map((p) => ({
        user_id: userId, machine_id: id, t: Math.round(p.t), cpu: p.cpu ?? null, gpu: p.gpu ?? null, busy: !!p.busy,
        fan: p.fan == null ? null : Math.round(p.fan), game: p.game ? p.game.slice(0, GAME_NAME_MAX) : null,
        cpu_load: whole(p.cpuLoad), gpu_load: whole(p.gpuLoad), mem: whole(p.mem), drive: whole(p.drive), board: whole(p.board),
      }));
      if (points.length) {
        await trx.insertInto("machine_history").values(points)
          .onConflict((oc) => oc.columns(["user_id", "machine_id", "t"]).doUpdateSet((eb) => ({
            cpu: eb.ref("excluded.cpu"), gpu: eb.ref("excluded.gpu"), busy: eb.ref("excluded.busy"),
            fan: eb.ref("excluded.fan"), game: eb.ref("excluded.game"),
            cpu_load: eb.ref("excluded.cpu_load"), gpu_load: eb.ref("excluded.gpu_load"), mem: eb.ref("excluded.mem"),
            drive: eb.ref("excluded.drive"), board: eb.ref("excluded.board"),
          }))).execute();
      }
      await trx.deleteFrom("machine_history").where("user_id", "=", userId).where("machine_id", "=", id)
        .where("t", "<", now.getTime() - HISTORY_DAYS * 864e5).execute();
      return { identity, identityAt: identityAt ?? undefined, recordings: await new Store(trx).asked(userId, id, now) };
    });
  }

  // ----- Recordings -----

  /** Newest first, without their data. */
  async recordings(userId: string, machineId: string): Promise<RecordingInfo[]> {
    const rows = await this.db.selectFrom("recording").select("info").where("user_id", "=", userId).where("machine_id", "=", machineId)
      .orderBy("created_at", "desc").limit(RECORDINGS_MAX).execute();
    return rows.map((r) => r.info as RecordingInfo);
  }

  async recording(userId: string, machineId: string, id: string): Promise<Recording | null> {
    const r = await this.db.selectFrom("recording").select(["info", "data"]).where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", id).executeTakeFirst();
    return r ? withData(r) : null;
  }

  /** Every recording kept for a PC with its readings, for the data export. */
  private async allRecordings(userId: string, machineId: string): Promise<Recording[]> {
    const rows = await this.db.selectFrom("recording").select(["info", "data"]).where("user_id", "=", userId).where("machine_id", "=", machineId).orderBy("created_at", "desc").execute();
    return rows.map(withData);
  }

  /** Files a request for the PC to pick up. One at a time: returns the one already waiting or running instead. */
  async requestRecording(userId: string, machineId: string, req: RecordingRequest, now = new Date()): Promise<{ info: RecordingInfo; created: boolean }> {
    return this.db.transaction().execute(async (trx) => {
      const s = new Store(trx);
      await s.asked(userId, machineId, now);
      const busy = (await s.recordings(userId, machineId)).find(isActive);
      if (busy) return { info: busy, created: false };
      const info = toInfo(newRecording(req, machineId));
      await trx.insertInto("recording").values({ user_id: userId, machine_id: machineId, id: req.id, state: info.state, info: JSON.stringify(info), created_at: now, updated_at: now }).execute();
      await s.prune(userId, machineId, now);
      return { info, created: true };
    });
  }

  /** The desktop's upload of a recording as it starts, grows and finishes. Already checked and cut to size by the caller. */
  async putRecording(userId: string, machineId: string, r: Recording, now = new Date()): Promise<void> {
    const values = { state: r.state, info: JSON.stringify(toInfo(r)), data: JSON.stringify({ samples: r.samples, events: r.events }), updated_at: now };
    await this.db.insertInto("recording").values({ user_id: userId, machine_id: machineId, id: r.id, created_at: new Date(r.createdAt), ...values })
      .onConflict((oc) => oc.columns(["user_id", "machine_id", "id"]).doUpdateSet(values)).execute();
    await this.prune(userId, machineId, now);
  }

  /** Stop from the web. One still waiting is cancelled here; one that's running is stopped by the PC at its next sync. */
  async stopRecording(userId: string, machineId: string, id: string, now = new Date()): Promise<boolean> {
    const r = await this.recording(userId, machineId, id);
    if (!r) return false;
    if (r.state === "pending") {
      const info: RecordingInfo = { ...toInfo(r), state: "cancelled", finishedAt: now.getTime() };
      await this.db.updateTable("recording").set({ state: "cancelled", info: JSON.stringify(info), updated_at: now })
        .where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", id).execute();
    } else if (r.state === "recording") {
      await this.db.updateTable("recording").set({ stop_requested: true, updated_at: now })
        .where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", id).execute();
    }
    return true;
  }

  /** What the PC should do at this sync: start what's waiting, stop what the person stopped on the web. */
  private async asked(userId: string, machineId: string, now: Date): Promise<{ start: RecordingRequest[]; stop: string[] }> {
    const rows = await this.db.selectFrom("recording").select(["id", "state", "info", "stop_requested", "created_at"])
      .where("user_id", "=", userId).where("machine_id", "=", machineId).where("state", "in", ["pending", "recording"]).orderBy("created_at").execute();
    const start: RecordingRequest[] = [];
    for (const r of rows.filter((x) => x.state === "pending")) {
      const info = r.info as RecordingInfo;
      if (now.getTime() - new Date(r.created_at).getTime() <= PENDING_MS) { start.push(toRequest(info)); continue; }
      const gone: RecordingInfo = { ...info, state: "failed", error: "The PC didn't come online within a day, so Rig gave up on this one.", finishedAt: now.getTime() };
      await this.db.updateTable("recording").set({ state: "failed", info: JSON.stringify(gone), updated_at: now })
        .where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", r.id).execute();
    }
    const stop: string[] = [];
    for (const r of rows.filter((x) => x.state === "recording")) {
      const info = r.info as RecordingInfo;
      if (now.getTime() - (info.endsAt ?? new Date(r.created_at).getTime()) <= PENDING_MS) { if (r.stop_requested) stop.push(r.id); continue; }
      const gone: RecordingInfo = { ...info, state: "failed", error: "The PC went offline before the recording finished and didn't come back within a day.", finishedAt: now.getTime() };
      await this.db.updateTable("recording").set({ state: "failed", info: JSON.stringify(gone), updated_at: now })
        .where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", r.id).execute();
    }
    return { start, stop };
  }

  private async prune(userId: string, machineId: string, now: Date) {
    const mine = () => this.db.deleteFrom("recording").where("user_id", "=", userId).where("machine_id", "=", machineId);
    await mine().where("created_at", "<", new Date(now.getTime() - RECORDINGS_DAYS * 864e5)).execute();
    const keep = this.db.selectFrom("recording").select("id").where("user_id", "=", userId).where("machine_id", "=", machineId).orderBy("created_at", "desc").limit(RECORDINGS_MAX);
    await mine().where("id", "not in", keep).execute();
  }

  // ----- Manuals -----

  /** The PC's manuals, newest first, without their page text. */
  async manuals(userId: string, machineId: string): Promise<Manual[]> {
    const rows = await this.db.selectFrom("manuals").selectAll().where("user_id", "=", userId).where("machine_id", "=", machineId)
      .orderBy("added_at", "desc").execute();
    return rows.map(toManual);
  }

  async manual(userId: string, machineId: string, id: string): Promise<Manual | null> {
    const r = await this.db.selectFrom("manuals").selectAll().where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", id).executeTakeFirst();
    return r ? toManual(r) : null;
  }

  /** Adds a part's manual, unread. The part's old manual and its pages go. */
  async putManual(userId: string, machineId: string, m: Pick<Manual, "id" | "part" | "kind" | "maker" | "model" | "title" | "url" | "host" | "source" | "bytes">, now = new Date()): Promise<Manual> {
    return this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("manuals").where("user_id", "=", userId).where("machine_id", "=", machineId).where("part", "=", m.part).execute();
      const row = await trx.insertInto("manuals").values({
        id: m.id, user_id: userId, machine_id: machineId, part: m.part, kind: m.kind, maker: m.maker, model: m.model, title: m.title,
        url: m.url ?? null, host: m.host ?? null, source: m.source, bytes: m.bytes ?? null, added_at: now,
      }).returningAll().executeTakeFirstOrThrow();
      return toManual(row);
    });
  }

  async removeManual(userId: string, machineId: string, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom("manuals").where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", id).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /** Replaces a manual's page text and diagram pages in one go, and marks it read. Null when there's no such manual. */
  async saveManualPages(userId: string, machineId: string, id: string, read: { pages: ManualPage[]; diagrams: ManualDiagram[]; pageCount: number }): Promise<Manual | null> {
    return this.db.transaction().execute(async (trx) => {
      const r = await trx.updateTable("manuals").set({ indexed: true, page_count: read.pageCount, diagrams: JSON.stringify(read.diagrams) })
        .where("user_id", "=", userId).where("machine_id", "=", machineId).where("id", "=", id).returningAll().executeTakeFirst();
      if (!r) return null;
      await trx.deleteFrom("manual_pages").where("manual_id", "=", id).execute();
      for (let i = 0; i < read.pages.length; i += 100) {
        await trx.insertInto("manual_pages").values(read.pages.slice(i, i + 100).map((p) => ({ manual_id: id, n: p.n, text: p.text }))).execute();
      }
      return toManual(r);
    });
  }

  async manualPage(userId: string, machineId: string, id: string, n: number): Promise<ManualPage | null> {
    const r = await this.db.selectFrom("manual_pages").innerJoin("manuals", "manuals.id", "manual_pages.manual_id")
      .select(["manual_pages.n", "manual_pages.text"])
      .where("manuals.user_id", "=", userId).where("manuals.machine_id", "=", machineId).where("manuals.id", "=", id).where("manual_pages.n", "=", n)
      .executeTakeFirst();
    return r ? { n: r.n, text: r.text } : null;
  }

  /**
   * Full-text search over the PC's manuals, best matches first. The question
   * is read twice, stemmed English and word for word, and a page matches
   * either. A question with no searchable words (only "the", say) finds nothing.
   * `part` narrows to one part's manual, by part key or kind.
   */
  async searchManuals(userId: string, machineId: string, query: string, opts: { manualId?: string; part?: string; limit: number }): Promise<PageMatch[]> {
    const q = query.slice(0, 200);
    const r = await sql<{ manual_id: string; title: string; model: string; part: string; n: number; text: string; snippet: string }>`
      select r.manual_id, r.title, r.model, r.part, r.n, r.text,
        ts_headline('english', r.text, r.q, 'StartSel=«, StopSel=», MaxWords=32, MinWords=12, ShortWord=2, MaxFragments=1') as snippet
      from (
        select p.manual_id, m.title, m.model, m.part, p.n, p.text, m.added_at, (q.en || q.si) as q,
          greatest(ts_rank_cd(p.tsv, q.en), ts_rank_cd(p.tsv, q.si)) as rank
        from (select websearch_to_tsquery('english', ${q}) as en, websearch_to_tsquery('simple', ${q}) as si) q
        join manual_pages p on (p.tsv @@ q.en or p.tsv @@ q.si)
        join manuals m on m.id = p.manual_id
        where numnode(q.en) > 0 and m.user_id = ${userId} and m.machine_id = ${machineId}
          ${opts.manualId ? sql`and m.id = ${opts.manualId}` : sql``}
          ${opts.part ? sql`and (m.part = ${opts.part} or m.kind = ${opts.part})` : sql``}
        order by rank desc, m.added_at desc, p.n
        limit ${opts.limit}
      ) r
      order by r.rank desc, r.added_at desc, r.n`.execute(this.db);
    return r.rows.map((x) => ({ manualId: x.manual_id, title: x.title, model: x.model, part: x.part, page: x.n, text: x.text, snippet: x.snippet }));
  }

  /** What the finder last found for a part ("kind|maker|model"), shared by every account. */
  async manualSource(key: string): Promise<{ found: Found } | { missedAt: Date } | null> {
    const r = await this.db.selectFrom("manual_sources").selectAll().where("key", "=", key).executeTakeFirst();
    if (r?.url) return { found: { url: r.url, title: r.title ?? "", host: r.host ?? new URL(r.url).hostname, ...(r.bytes != null ? { bytes: r.bytes } : {}) } };
    return r?.missed_at ? { missedAt: new Date(r.missed_at) } : null;
  }

  /** Remembers what the finder found, or that it found nothing (null). */
  async saveManualSource(key: string, found: Found | null, now = new Date()): Promise<void> {
    const values = found
      ? { url: found.url, title: found.title, host: found.host, bytes: found.bytes ?? null, found_at: now, missed_at: null }
      : { url: null, title: null, host: null, bytes: null, found_at: null, missed_at: now };
    await this.db.insertInto("manual_sources").values({ key, ...values })
      .onConflict((oc) => oc.column("key").doUpdateSet(values)).execute();
  }

  /** Forgets a found address that turned out to be gone, so the next lookup searches again. */
  async forgetManualSource(key: string, url: string): Promise<void> {
    await this.db.deleteFrom("manual_sources").where("key", "=", key).where("url", "=", url).execute();
  }

  /** A board model's shared layout record: done, being read, or failed. */
  async boardLayout(key: string): Promise<BoardLayoutRow | null> {
    const r = await this.db.selectFrom("board_layouts").selectAll().where("key", "=", key).executeTakeFirst();
    return r ? { ...r, started_at: new Date(r.started_at), updated_at: new Date(r.updated_at) } : null;
  }

  /**
   * Claims one board model's read, so it runs once however many PCs ask at
   * the same time. True when this caller should read it: nobody has, a read
   * that started over `staleMs` ago never finished, or the last one failed
   * over `retryMs` ago.
   */
  async claimBoardLayout(key: string, who: { maker: string; model: string; page: number; userId: string }, now: Date, staleMs: number, retryMs: number): Promise<boolean> {
    const values = { maker: who.maker, model: who.model, status: "reading" as const, page: who.page, read_by: who.userId, started_at: now, updated_at: now, problem: null, reading: null };
    const r = await this.db.insertInto("board_layouts").values({ key, ...values })
      .onConflict((oc) => oc.column("key").doUpdateSet(values).where((eb) => eb.or([
        eb.and([eb("board_layouts.status", "=", "reading"), eb("board_layouts.started_at", "<", new Date(now.getTime() - staleMs))]),
        eb.and([eb("board_layouts.status", "=", "failed"), eb("board_layouts.updated_at", "<", new Date(now.getTime() - retryMs))]),
      ])))
      .returning("key").executeTakeFirst();
    return !!r;
  }

  /** Saves a claimed read: its reading, or why it failed, and what it cost. */
  async finishBoardLayout(key: string, out: { reading?: unknown; problem?: string; reader?: string; inputTokens?: number; outputTokens?: number; ms?: number }, now: Date): Promise<void> {
    await this.db.updateTable("board_layouts").set({
      status: out.reading ? "done" : "failed",
      reading: out.reading ? JSON.stringify(out.reading) : null,
      problem: out.problem ?? null, reader: out.reader ?? null,
      input_tokens: out.inputTokens ?? null, output_tokens: out.outputTokens ?? null, ms: out.ms ?? null, updated_at: now,
    }).where("key", "=", key).execute();
  }

  /** Website rename, new color or "I cleaned it today". */
  async rename(userId: string, id: string, patch: Identity, now = new Date()): Promise<boolean> {
    const m = await this.machine(userId, id);
    if (!m) return false;
    await this.db.updateTable("machine").set({ identity: JSON.stringify({ ...m.identity, ...patch }), identity_at: now })
      .where("user_id", "=", userId).where("id", "=", id).execute();
    return true;
  }

  async history(userId: string, id: string, sinceMs: number): Promise<HistoryPoint[]> {
    const rows = await this.db.selectFrom("machine_history").select(["t", "cpu", "gpu", "busy", "fan", "game", "cpu_load", "gpu_load", "mem", "drive", "board"])
      .where("user_id", "=", userId).where("machine_id", "=", id).where("t", ">=", sinceMs).orderBy("t").execute();
    return rows.map((r) => ({
      t: Number(r.t), cpu: r.cpu, gpu: r.gpu, busy: r.busy, fan: r.fan, game: r.game,
      cpuLoad: r.cpu_load, gpuLoad: r.gpu_load, mem: r.mem, drive: r.drive, board: r.board,
    }));
  }

  /** Counts one question and says whether it's within today's allowance. */
  async useChat(userId: string, limit: number, now = new Date()): Promise<boolean> {
    const day = now.toISOString().slice(0, 10);
    const r = await this.db.insertInto("chat_usage").values({ user_id: userId, day, count: 1 })
      .onConflict((oc) => oc.columns(["user_id", "day"]).doUpdateSet({ count: sql<number>`chat_usage.count + 1` }))
      .returning("count").executeTakeFirst();
    return (r?.count ?? 1) <= limit;
  }

  /** Everything kept for the account: its PCs, all their history, Windows events, recordings and manuals (not their page text), and chat use. */
  async exportAccount(userId: string, now = new Date()): Promise<DataExport | null> {
    const user = await this.db.selectFrom("user").select(["id", "name", "email", "createdAt"]).where("id", "=", userId).executeTakeFirst();
    if (!user) return null;
    const rows = await this.machines(userId);
    const machines = await Promise.all(rows.map(async (m) => ({
      id: m.id, view: present(m, now.getTime()), inventory: m.inventory, facts: m.facts, identity: m.identity,
      syncedAt: m.syncedAt, changes: m.changes, games: m.games, history: await this.history(userId, m.id, 0),
      events: m.events, recordings: await this.allRecordings(userId, m.id), manuals: await this.manuals(userId, m.id),
    })));
    const usage = await this.db.selectFrom("chat_usage").select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as("day"), "count"]).where("user_id", "=", userId).execute();
    return makeExport({
      account: { id: user.id, name: user.name, email: user.email, createdAt: iso(user.createdAt) ?? undefined },
      machines,
      chatUsage: usage,
      notes: [`The server keeps ${HISTORY_DAYS} days of history. The Rig app on each PC keeps more.`],
      now,
    });
  }

  /**
   * Deletes the account and everything on it in one transaction: chat use,
   * history, PCs (with their recordings), manuals and their pages, desktop sign-in codes, sign-ins and the account itself.
   * Returns false when there was no such account.
   */
  async deleteAccount(userId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("chat_usage").where("user_id", "=", userId).execute();
      await trx.deleteFrom("machine_history").where("user_id", "=", userId).execute();
      await trx.deleteFrom("manuals").where("user_id", "=", userId).execute(); // their pages go with them
      await trx.deleteFrom("machine").where("user_id", "=", userId).execute();
      await trx.deleteFrom("deviceCode").where("userId", "=", userId).execute();
      await trx.deleteFrom("session").where("userId", "=", userId).execute();
      await trx.deleteFrom("account").where("userId", "=", userId).execute();
      const r = await trx.deleteFrom("user").where("id", "=", userId).executeTakeFirst();
      return Number(r.numDeletedRows) > 0;
    });
  }
}
