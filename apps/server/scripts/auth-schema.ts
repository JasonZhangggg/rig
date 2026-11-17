// Prints the Postgres SQL for Better Auth's tables, for migrations/0001_init.sql.
// Run: pnpm --filter @rig/server auth:schema
import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/auth";
import type { Env } from "../src/env";
import { pgliteDialect } from "../test/pglite";

const env = { WEB_ORIGIN: "http://localhost:8787", BETTER_AUTH_SECRET: "x".repeat(32) } as Env;
const db = new Kysely({ dialect: pgliteDialect(new PGlite()) });
const { compileMigrations } = await getMigrations(authOptions(env, { db, type: "postgres" }));
console.log(await compileMigrations());
