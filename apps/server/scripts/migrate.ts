// Applies migrations/*.sql to the database in DATABASE_URL, each once, in order.
// Run: DATABASE_URL=postgres://... pnpm --filter @rig/server db:migrate
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL to the database's connection string first."); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("create table if not exists rig_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query<{ name: string }>("select name from rig_migrations")).rows.map((r) => r.name));
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await client.query("begin");
    try {
      await client.query(readFileSync(new URL(f, dir), "utf8"));
      await client.query("insert into rig_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`Applied ${f}`);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  console.log(files.every((f) => done.has(f)) ? "Already up to date." : "Done.");
} finally {
  await client.end();
}
