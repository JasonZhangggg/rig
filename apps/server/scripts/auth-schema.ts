// Prints the SQL for Better Auth's tables, for migrations/0001_init.sql.
// Run: pnpm --filter @rig/server auth:schema
import Database from "better-sqlite3";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/auth";
import type { Env } from "../src/env";

const env = { WEB_ORIGIN: "http://localhost:8787", BETTER_AUTH_SECRET: "x".repeat(32) } as Env;
const { compileMigrations } = await getMigrations(authOptions(env, new Database(":memory:")));
console.log(await compileMigrations());
