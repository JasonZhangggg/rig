// Rig's own tables: the PCs on each account, their temperature history and
// chat use. Better Auth keeps its own tables (user, session, account, …) in
// the same database.

import { sql, type Selectable } from "kysely";
import {
  cleanEvents, isActive, newRecording, toInfo, toRequest,
  type Change, type Game, type HistoryPoint, type Identity, type Inventory, type MachineSync, type PC, type PCEvent,
  type Recording, type RecordingInfo, type RecordingRequest, type SystemFacts,
} from "@rig/core";
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

function fromRow(r: Row): MachineRow {
  return {
    id: r.id, view: r.view as PC, inventory: (r.inventory as Inventory | null) ?? null, facts: (r.facts as SystemFacts | null) ?? null,
    changes: (r.changes as Change[]) ?? [], games: (r.games as Game[]) ?? [], identity: (r.identity as Identity) ?? {},
    identityAt: iso(r.identity_at), syncedAt: iso(r.synced_at)!, events: (r.events as PCEvent[]) ?? [],
  };
}

/** The view the website shows: the PC's last upload with the account's name and color on top. */
export function present(m: MachineRow, now = Date.now()): PC {
  const seen = Date.parse(m.syncedAt);
  const id = Object.fromEntries(Object.entries(m.identity).filter(([, v]) => v != null)) as Identity;
  return { ...m.view, ...id, id: m.id, lastSync: m.syncedAt, seenAt: m.view.seenAt ?? m.syncedAt, online: now - seen < ONLINE_MS };
}

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
      }));
      if (points.length) {
        await trx.insertInto("machine_history").values(points)
          .onConflict((oc) => oc.columns(["user_id", "machine_id", "t"]).doUpdateSet((eb) => ({
            cpu: eb.ref("excluded.cpu"), gpu: eb.ref("excluded.gpu"), busy: eb.ref("excluded.busy"),
            fan: eb.ref("excluded.fan"), game: eb.ref("excluded.game"),
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
    if (!r) return null;
    const data = (r.data ?? {}) as Partial<Pick<Recording, "samples" | "events">>;
    return { ...(r.info as RecordingInfo), samples: data.samples ?? [], events: data.events ?? [] };
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

  /** Website rename, new color or "I cleaned it today". */
  async rename(userId: string, id: string, patch: Identity, now = new Date()): Promise<boolean> {
    const m = await this.machine(userId, id);
    if (!m) return false;
    await this.db.updateTable("machine").set({ identity: JSON.stringify({ ...m.identity, ...patch }), identity_at: now })
      .where("user_id", "=", userId).where("id", "=", id).execute();
    return true;
  }

  async history(userId: string, id: string, sinceMs: number): Promise<HistoryPoint[]> {
    const rows = await this.db.selectFrom("machine_history").select(["t", "cpu", "gpu", "busy", "fan", "game"])
      .where("user_id", "=", userId).where("machine_id", "=", id).where("t", ">=", sinceMs).orderBy("t").execute();
    return rows.map((r) => ({ t: Number(r.t), cpu: r.cpu, gpu: r.gpu, busy: r.busy, fan: r.fan, game: r.game }));
  }

  /** Counts one question and says whether it's within today's allowance. */
  async useChat(userId: string, limit: number, now = new Date()): Promise<boolean> {
    const day = now.toISOString().slice(0, 10);
    const r = await this.db.insertInto("chat_usage").values({ user_id: userId, day, count: 1 })
      .onConflict((oc) => oc.columns(["user_id", "day"]).doUpdateSet({ count: sql<number>`chat_usage.count + 1` }))
      .returning("count").executeTakeFirst();
    return (r?.count ?? 1) <= limit;
  }
}
