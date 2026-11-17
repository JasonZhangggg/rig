// Just enough of Cloudflare D1's API on top of better-sqlite3 to run the
// server, Better Auth included, in tests. Loads the real migration.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

type Value = string | number | bigint | null | Buffer;
const norm = (v: unknown): Value => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v instanceof Date ? v.toISOString() : (v as Value));

class Stmt {
  constructor(private db: Database.Database, private sql: string, private args: Value[] = []) {}
  bind(...args: unknown[]) { return new Stmt(this.db, this.sql, args.map(norm)); }
  private run_() {
    const s = this.db.prepare(this.sql);
    if (s.reader) return { results: s.all(...this.args) as Record<string, unknown>[], meta: { changes: 0, last_row_id: null as number | null } };
    const r = s.run(...this.args);
    return { results: [] as Record<string, unknown>[], meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return { success: true, ...this.run_() }; }
  async run() { return { success: true, ...this.run_() }; }
  async first(col?: string) {
    const row = this.run_().results[0] ?? null;
    return row && col ? (row[col] ?? null) : row;
  }
  async raw() { return this.run_().results.map((r) => Object.values(r)); }
  /** For batch(). */
  sync() { return { success: true, ...this.run_() }; }
}

export function testD1(): D1Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const d1 = {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) { return db.transaction(() => stmts.map((s) => s.sync()))(); },
    async exec(sql: string) { db.exec(sql); return { count: 1, duration: 0 }; },
    dump: async () => new ArrayBuffer(0),
    withSession: () => d1,
  };
  return d1 as unknown as D1Database;
}
