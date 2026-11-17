// Rig's own tables: the PCs on each account, their temperature history and
// chat use. Better Auth keeps its own tables (user, session, account, …) in
// the same database.

import type { Change, Game, HistoryPoint, Identity, Inventory, MachineSync, PC, SystemFacts } from "@rig/core";

const HISTORY_DAYS = 30;
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

interface Raw {
  id: string; view: string; inventory: string | null; facts: string | null; changes: string | null; games: string | null;
  identity: string | null; identity_at: string | null; synced_at: string;
}

const parse = <T>(s: string | null, empty: T): T => (s ? (JSON.parse(s) as T) : empty);

function fromRaw(r: Raw): MachineRow {
  return {
    id: r.id, view: JSON.parse(r.view), inventory: parse(r.inventory, null), facts: parse(r.facts, null),
    changes: parse(r.changes, []), games: parse(r.games, []), identity: parse(r.identity, {}), identityAt: r.identity_at, syncedAt: r.synced_at,
  };
}

/** The view the website shows: the PC's last upload with the account's name and color on top. */
export function present(m: MachineRow, now = Date.now()): PC {
  const seen = Date.parse(m.syncedAt);
  const id = Object.fromEntries(Object.entries(m.identity).filter(([, v]) => v != null)) as Identity;
  return { ...m.view, ...id, id: m.id, lastSync: m.syncedAt, seenAt: m.view.seenAt ?? m.syncedAt, online: now - seen < ONLINE_MS };
}

export class Store {
  constructor(private db: D1Database) {}

  async machines(userId: string): Promise<MachineRow[]> {
    const { results } = await this.db.prepare("SELECT * FROM machine WHERE user_id = ? ORDER BY synced_at DESC").bind(userId).all<Raw>();
    return results.map(fromRaw);
  }

  async machine(userId: string, id: string): Promise<MachineRow | null> {
    const r = await this.db.prepare("SELECT * FROM machine WHERE user_id = ? AND id = ?").bind(userId, id).first<Raw>();
    return r ? fromRaw(r) : null;
  }

  /** Saves an upload. The identity changed most recently, here or on the web, wins. */
  async sync(userId: string, id: string, s: MachineSync, now = new Date()): Promise<{ identity: Identity; identityAt?: string }> {
    const old = await this.machine(userId, id);
    const keepOld = old?.identityAt && (!s.identityAt || old.identityAt >= s.identityAt);
    const identity = keepOld ? old!.identity : s.identity ?? {};
    const identityAt = keepOld ? old!.identityAt! : s.identityAt ?? null;
    const at = now.toISOString();
    const stmts = [
      this.db.prepare(
        `INSERT INTO machine (user_id, id, view, inventory, facts, changes, games, identity, identity_at, synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, id) DO UPDATE SET view = excluded.view, inventory = excluded.inventory, facts = excluded.facts,
           changes = excluded.changes, games = excluded.games, identity = excluded.identity, identity_at = excluded.identity_at, synced_at = excluded.synced_at`,
      ).bind(userId, id, JSON.stringify(s.view), JSON.stringify(s.inventory), JSON.stringify(s.facts), JSON.stringify(s.changes.slice(0, 200)),
        JSON.stringify(s.games), JSON.stringify(identity), identityAt, at, at),
      ...s.history.map((p) => this.db.prepare(
        "INSERT OR REPLACE INTO machine_history (user_id, machine_id, t, cpu, gpu, busy) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(userId, id, Math.round(p.t), p.cpu, p.gpu, p.busy ? 1 : 0)),
      this.db.prepare("DELETE FROM machine_history WHERE user_id = ? AND machine_id = ? AND t < ?").bind(userId, id, now.getTime() - HISTORY_DAYS * 864e5),
    ];
    await this.db.batch(stmts);
    return { identity, identityAt: identityAt ?? undefined };
  }

  /** Website rename, new color or "I cleaned it today". */
  async rename(userId: string, id: string, patch: Identity, now = new Date()): Promise<boolean> {
    const m = await this.machine(userId, id);
    if (!m) return false;
    const identity = { ...m.identity, ...patch };
    await this.db.prepare("UPDATE machine SET identity = ?, identity_at = ? WHERE user_id = ? AND id = ?")
      .bind(JSON.stringify(identity), now.toISOString(), userId, id).run();
    return true;
  }

  async history(userId: string, id: string, sinceMs: number): Promise<HistoryPoint[]> {
    const { results } = await this.db.prepare(
      "SELECT t, cpu, gpu, busy FROM machine_history WHERE user_id = ? AND machine_id = ? AND t >= ? ORDER BY t",
    ).bind(userId, id, sinceMs).all<{ t: number; cpu: number | null; gpu: number | null; busy: number }>();
    return results.map((r) => ({ t: r.t, cpu: r.cpu, gpu: r.gpu, busy: !!r.busy }));
  }

  /** Counts one question and says whether it's within today's allowance. */
  async useChat(userId: string, limit: number, now = new Date()): Promise<boolean> {
    const day = now.toISOString().slice(0, 10);
    const r = await this.db.prepare(
      `INSERT INTO chat_usage (user_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count`,
    ).bind(userId, day).first<{ count: number }>();
    return (r?.count ?? 1) <= limit;
  }
}
