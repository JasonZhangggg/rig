# Putting Rig online

One Cloudflare Worker serves the website and, under `/api`, accounts, sync and chat. Data lives in Cloudflare D1. Cloudflare's free plan covers this to start.

## What you need

- A Cloudflare account.
- A Claude API key from console.anthropic.com, for chat. Chat answers cost money per question; the server caps each account at `CHAT_DAILY_LIMIT` questions a day (40 by default).
- Optional: a Google Cloud OAuth client, for "Continue with Google".

## Steps

Run these from `apps/server`.

1. `npx wrangler login`
2. `npx wrangler d1 create rig` and copy the `database_id` it prints into `wrangler.toml`.
3. In `wrangler.toml`, set `WEB_ORIGIN` to the address people will open, like `https://rig.example.com` or `https://rig.<you>.workers.dev`.
4. `npx wrangler d1 migrations apply rig --remote`
5. Secrets (each one asks for the value; nothing goes in the repo):
   - `npx wrangler secret put BETTER_AUTH_SECRET` with a long random string (`openssl rand -base64 32`)
   - `npx wrangler secret put ANTHROPIC_API_KEY`
   - Google, optional: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Cloud, the OAuth client's redirect URI is `<WEB_ORIGIN>/api/auth/callback/google`.
6. `pnpm --filter @rig/web build`, then `npx wrangler deploy`.
7. So installers built by CI talk to this server: in GitHub, Settings, Secrets and variables, Actions, Variables, add `RIG_API_URL` = `<WEB_ORIGIN>/api`.

## Running it locally

```
cd apps/server
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" > .dev.vars   # add ANTHROPIC_API_KEY=... for chat
npx wrangler d1 migrations apply rig --local
pnpm --filter @rig/web build && npx wrangler dev                            # http://localhost:8787
```

`pnpm dev:web` (port 5173) passes `/api` through to `wrangler dev`, for working on the screens with live reload.

## Not done yet

- Password reset and email verification need an email service (for example Cloudflare Email or Resend).
- Deleting an account from inside the app.
