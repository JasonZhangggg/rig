/** Bindings and settings the Worker gets from wrangler.toml and `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Where the website lives, like https://rig.example.com. Also Better Auth's base URL. */
  WEB_ORIGIN: string;
  /** Long random string that signs sessions. Secret. */
  BETTER_AUTH_SECRET: string;
  /** Claude API key for chat. Secret. Chat says it isn't set up when this is missing. */
  ANTHROPIC_API_KEY?: string;
  /** Google sign-in, both optional. Secret. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Questions each account can ask per day (default 40). */
  CHAT_DAILY_LIMIT?: string;
}
