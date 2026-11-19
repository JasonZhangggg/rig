/** Bindings and settings the Worker gets from wrangler.toml and `wrangler secret put`. */
export interface Env {
  /** Cloudflare Hyperdrive in front of the Postgres database. */
  HYPERDRIVE?: Hyperdrive;
  /** A Postgres connection string, used when there's no Hyperdrive binding (tests, scripts). */
  DATABASE_URL?: string;
  ASSETS?: Fetcher;
  /** Installers for the app's updater and releases.json (see routes-updates.ts). */
  UPDATES?: R2Bucket;
  /** Where the website lives, like https://rig.example.com. Also Better Auth's base URL. */
  WEB_ORIGIN: string;
  /** Long random string that signs sessions. Secret. */
  BETTER_AUTH_SECRET: string;
  /** Claude API key for chat. Secret. Chat says it isn't set up when this is missing. */
  ANTHROPIC_API_KEY?: string;
  /** Google sign-in, both optional. Secret. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Best Buy Products API key, for real photos and prices on Upgrades. Secret. Without it every price is demo. */
  BESTBUY_API_KEY?: string;
  /** Questions each account can ask per day (default 40). */
  CHAT_DAILY_LIMIT?: string;
}
