// Rig's own tables: the PCs on each account, their temperature history and
// chat use. Better Auth keeps its own tables (user, session, account, …) in
// the same database.

import { sql, type Selectable } from "kysely";
import type { Change, Game, HistoryPoint, Identity, Inventory, MachineSync, PC, SystemFacts } from "@rig/core";
import type { DB, RigTables } from "./sql";

const HISTORY_DAYS = 30;
/** The desktop sends at most this many points per sync. */
const HISTORY_MAX = 2000;
const GAME_NAME_MAX = 120;
/** A PC counts as online when it synced this recently. The desktop syncs every 5 minutes. */
const ONLINE_MS = 12 * 60_000;

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
}

type Row = Selectable<RigTables["machine"]>;

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

function fromRow(r: Row): MachineRow {
  return {
    id: r.id, view: r.view as PC, inventory: (r.inventory as Inventory | null) ?? null, facts: (r.facts as SystemFacts | null) ?? null,
    changes: (r.changes as Change[]) ?? [], games: (r.games as Game[]) ?? [], identity: (r.identity as Identity) ?? {},
    identityAt: iso(r.identity_at), syncedAt: iso(r.synced_at)!,
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
  async sync(userId: string, id: string, s: MachineSync, now = new Date()): Promise<{ identity: Identity; identityAt?: string }> {
    return this.db.transaction().execute(async (trx) => {
      const old = await new Store(trx).machine(userId, id);
      const keepOld = old?.identityAt && (!s.identityAt || Date.parse(old.identityAt) >= Date.parse(s.identityAt));
      const identity = keepOld ? old!.identity : s.identity ?? {};
      const identityAt = keepOld ? old!.identityAt! : s.identityAt ? new Date(s.identityAt).toISOString() : null;
      const values = {
        view: JSON.stringify(s.view), inventory: JSON.stringify(s.inventory), facts: JSON.stringify(s.facts),
        changes: JSON.stringify(s.changes.slice(0, 200)), games: JSON.stringify(s.games),
        identity: JSON.stringify(identity), identity_at: identityAt, synced_at: now,
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
      return { identity, identityAt: identityAt ?? undefined };
    });
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
