# Putting Rig online

One Cloudflare Worker serves the website and, under `/api`, accounts, sync and chat. Data lives in Postgres on Neon, which the Worker reaches through Cloudflare Hyperdrive (it keeps database connections warm near the database). Cloudflare's free plan covers the Worker and Hyperdrive to start.

## What you need

- A Cloudflare account.
- A Neon account (neon.tech) with one project. Any Postgres works; Neon is the default here.
- A Claude API key from console.anthropic.com, for chat. Chat answers cost money per question; the server caps each account at `CHAT_DAILY_LIMIT` questions a day (40 by default).
- Optional: a Google Cloud OAuth client, for "Continue with Google".

## The quick way: Deploy in GitHub Actions

1. In Neon, create a project and copy its connection string. Use the direct one, not the pooled one, since Hyperdrive does the pooling.
2. In Cloudflare, note the account ID (on the dashboard's Workers page) and create an API token with the "Edit Cloudflare Workers" template, plus Hyperdrive edit permission.
3. In GitHub, Settings, Secrets and variables, Actions, add these repository secrets:
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   - `DATABASE_URL`, the Neon connection string
   - `BETTER_AUTH_SECRET`, a long random string (`openssl rand -base64 32`)
   - `ANTHROPIC_API_KEY`, for chat (without it, chat says it isn't set up)
   - Optional: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
4. Push to the `deploy` branch (`git push origin HEAD:deploy`), or Actions, Deploy, Run workflow. Leave the address empty to use `https://rig.<your-subdomain>.workers.dev`, or give your own. It creates the tables, connects Hyperdrive, builds the website and deploys. Running it again updates everything.
5. Add the repository variable `RIG_API_URL` = `<that address>/api`, so installers built by CI use this server.

Nothing secret goes in the repo or the logs; the workflow passes secrets straight to Cloudflare.

## By hand

Run these from `apps/server`.

1. `npx wrangler login`
2. In Neon, copy the project's connection string. Use the direct one, not the pooled one, since Hyperdrive does the pooling.
3. Create the tables: `DATABASE_URL='<connection string>' pnpm db:migrate`. It's safe to run again; it only applies what's new.
4. `npx wrangler hyperdrive create rig --connection-string='<connection string>'` and copy the `id` it prints into `wrangler.toml`, under `[[hyperdrive]]`.
5. In `wrangler.toml`, set `WEB_ORIGIN` to the address people will open, like `https://rig.example.com` or `https://rig.<you>.workers.dev`.
6. Secrets (each one asks for the value; nothing goes in the repo):
   - `npx wrangler secret put BETTER_AUTH_SECRET` with a long random string (`openssl rand -base64 32`)
   - `npx wrangler secret put ANTHROPIC_API_KEY`
   - Google, optional: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Cloud, the OAuth client's redirect URI is `<WEB_ORIGIN>/api/auth/callback/google`.
7. `pnpm --filter @rig/web build`, then `npx wrangler deploy`.
8. So installers built by CI talk to this server: in GitHub, Settings, Secrets and variables, Actions, Variables, add `RIG_API_URL` = `<WEB_ORIGIN>/api`.

## Running it locally

```
cd apps/server
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" > .dev.vars   # add ANTHROPIC_API_KEY=... for chat
DATABASE_URL=postgres://rig:rig@localhost:5432/rig pnpm db:migrate
pnpm --filter @rig/web build && npx wrangler dev                            # http://localhost:8787
```

This needs a local Postgres with a `rig` user and database (password `rig`), the address in `localConnectionString` in `wrangler.toml`. With Docker: `docker run -d -p 5432:5432 -e POSTGRES_USER=rig -e POSTGRES_PASSWORD=rig postgres:16`. The tests don't need any of this; they run Postgres in memory (PGlite).

`pnpm dev:web` (port 5173) passes `/api` through to `wrangler dev`, for working on the screens with live reload.

## Not done yet

- Password reset and email verification need an email service (for example Cloudflare Email or Resend).
- Deleting an account from inside the app.
