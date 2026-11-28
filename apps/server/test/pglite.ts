// A Kysely dialect over PGlite, Postgres compiled to WebAssembly, so tests and
// the schema script run real Postgres with nothing to install.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import {
  CompiledQuery, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  type DatabaseConnection, type Dialect, type Driver, type QueryResult,
} from "kysely";

class Connection implements DatabaseConnection {
  constructor(private pg: PGlite, private seen?: (sql: string) => void) {}
  async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
    this.seen?.(q.sql);
    const r = await this.pg.query<R>(q.sql, q.parameters as unknown[]);
    return { rows: r.rows, numAffectedRows: r.affectedRows !== undefined ? BigInt(r.affectedRows) : undefined };
  }
  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error("Not supported"); }
}

/** One connection, handed out one caller at a time, like a pool of size one. */
class PGliteDriver implements Driver {
  private conn: Connection;
  private queue: Promise<void> = Promise.resolve();
  private release_: (() => void) | null = null;
  constructor(pg: PGlite, seen?: (sql: string) => void) { this.conn = new Connection(pg, seen); }
  async init() {}
  async acquireConnection() {
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise((r) => (release = r));
    await prev;
    this.release_ = release;
    return this.conn;
  }
  async beginTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw("begin")); }
  async commitTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw("commit")); }
  async rollbackTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw("rollback")); }
  async releaseConnection() { const r = this.release_; this.release_ = null; r?.(); }
  async destroy() {}
}

export const pgliteDialect = (pg: PGlite, seen?: (sql: string) => void): Dialect => ({
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new PGliteDriver(pg, seen),
  createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
});

/** A fresh in-memory Postgres with Rig's migrations applied. `seen` hears each query's SQL. */
export async function testDb<DB>(seen?: (sql: string) => void): Promise<Kysely<DB>> {
  const pg = new PGlite();
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(new URL(f, dir), "utf8"));
  return new Kysely<DB>({ dialect: pgliteDialect(pg, seen) });
}
