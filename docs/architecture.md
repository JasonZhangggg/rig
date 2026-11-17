# How Rig is built

## The pieces

```
 Website (apps/web)            Desktop app (apps/desktop, Tauri)
   CloudClient                   LocalClient ──────────────┐
      │                              │   Rust: SQLite store, keychain token
      │ cookie                       │ bearer token        │ named pipe (private)
      ▼                              ▼                     ▼
   Rig server (apps/server) ◄── sync ──┘            RigHelper.exe (admin)
   accounts · PC snapshots · chat                   LibreHardwareMonitor · WMI · fixes
```

Both apps mount the same `RigApp` from `packages/ui` and differ only in the client they pass in. Every client implements one interface, `RigClient` (`packages/core/src/client.ts`):

- `DemoClient`: two made-up PCs in memory, each following a weekly schedule of work, evening games and background tasks. Powers the website's demo and the UI tests.
- `LocalClient`: this PC, through the helper. History and the change log are kept on disk. When signed in it uploads a snapshot every five minutes and after each change, and reaches the account's other PCs through the server.
- `CloudClient`: the website. Reads what each PC uploaded. It can't make changes; those happen in the app on the PC itself.

The PC view the screens draw is built by one function, `buildPC` (`packages/core/src/view.ts`), from the helper's raw readings. The desktop runs it live and uploads the result, so the website shows exactly what the app shows.

## The server

`apps/server` is one Cloudflare Worker (Hono) with a Postgres database (Neon in production, reached through Cloudflare Hyperdrive; queries go through Kysely, which Better Auth uses too). It serves the website's files and, under `/api`:

- **Accounts** with [Better Auth](https://better-auth.com): email and password on the website, Google when it's configured, and the desktop sign-in. The desktop asks for a code (`/api/auth/device/code`) and opens `/app/?user_code=…`, where the person checks the code and approves. The app then gets a bearer token, kept in Windows Credential Manager.
- **PCs**: the desktop uploads its view, settings, change log and new history points (`PUT /api/machines/:id/sync`). The website reads them back. A PC is keyed by account and machine id, and counts as online when it synced in the last 12 minutes. Name and color can be changed on either side; whichever changed last wins.
- **Chat** (`POST /api/chat`, streamed): Claude (`claude-opus-5-5`) gets the PC's readings and settings, can search the web and read manuals and maker pages, and has two tools. `propose_change` shows a fix card; the server checks it against the fix catalog and against what's actually on that PC (the power plan, startup app or display has to exist) before the person sees it. `show_steps` shows numbered steps for things only the person can do. One card per answer, and nothing changes until the person approves in the app on that PC. Each account gets a daily allowance of questions.

How to put it online: [deploy.md](deploy.md).

## Changes are safe by construction

1. Every change Rig can make is in one list, the fix catalog (`packages/core/src/actions.ts`): power plan, startup apps, Game Mode, visual effects, processor speed cap, screen refresh rate. Chat can only propose calls from this list, and they're checked with `validateCall` on the server, in the app and again in the helper.
2. Before anything changes, the app reads the current values and shows a before and after table. Nothing happens until the person confirms.
3. The helper reads each old value before writing the new one and returns the call that puts it back. That undo call is stored in the change log with the change.
4. If one step of a multi-step change fails, the steps before it are put back, and the person is told nothing changed.
5. Undo replays the stored undo calls in reverse order. Redo replays the originals.

Rig never installs drivers, overclocks or touches games.

## The helper

`helper/RigHelper` is a .NET 8 program. The app starts it once through the Windows admin prompt (`ShellExecuteEx` with `runas`). If the person says No, it starts without admin rights and Rig shows which readings are missing.

Talking to it stays private: the app makes a named pipe with a random name that takes one connection, then checks the connected process is the helper it started. The helper checks the pipe belongs to its parent and quits when the app does. Requests are JSON, one per line: `hello`, `inventory`, `facts`, `snapshot`, `apply`, and two that only read: `events` (errors, crashes, driver resets and unexpected shutdowns from the Windows event log, at most 300 from the last 30 days) and `processes` (the busiest apps since the last call).

`RigHelper.exe --selftest out.json` reads everything once and writes it to a file. CI runs this on a Windows runner.

CPU temperatures and motherboard fans need LibreHardwareMonitor's PawnIO driver. Graphics cards, drives and batteries read without it. The installer doesn't add PawnIO yet (see open questions).

## Logs and recordings

When the chat can't tell what's wrong from the latest readings, it records. A recording keeps temperatures, load, fan speeds, the busiest apps and the Windows events that land while it runs, for 1 to 180 minutes. It only reads.

- **The model and the summary are in `packages/core/src/recordings.ts`.** A capture kind is one entry in the `captures` table and an event kind is one entry in `eventRules`; adding either is a table entry. `summarise` is pure: it finds sustained heat, a part pinned at full load, sudden drops and each Windows event, with the readings around it. The Logs screen and the chat both read that one summary, so the charts and Claude's answer agree.
- **The desktop runs it** (`recorder.ts`). It saves as it goes, so a recording survives the app closing or the PC crashing, which is often the thing being recorded, and it reads the event log when time is up. The newest 20 stay on the PC.
- **The chat has two tools**, `start_recording` and `read_recording`. On the desktop the recording starts at once. From the website the server stores the request and the desktop picks it up on its next upload, up to about five minutes later; the chat says so. When it finishes, the desktop uploads it, shows a Windows notification, and the chat offers "See what Rig found".
- **The server keeps them per account and PC** (`0004_recordings.sql`): the 20 newest for 90 days, one running at a time, and a request nobody picked up in a day is closed.
- **The Logs screen** (`packages/ui/src/pages/Logs.tsx`) lists Windows events by day with a kind filter, the recordings, and one recording with its charts, what Rig found marked on them, and "Ask about this".

## Defaults chosen

- **Monorepo with pnpm workspaces.** The website and the app share every screen.
- **Desktop data in SQLite** in the app's data folder; history keeps 90 days, one point per ten minutes with the highest temperatures and fan speed in that window, whether it was busy, and the game in front for most of it.
- **Home charts come from history** (`packages/core/src/insights.ts`), in the viewer's local days. Idle is the processor's median while nothing heavy ran; typical and peak are the graphics card's busy median and highest reading (the processor's on a laptop or a desktop without graphics card readings). An evening runs 6 PM to 6 AM; a session is busy windows joined across at most one quiet window, and it ran hot when a part came within 6°C of its safe limit. Fans show the fastest speed per six-hour slice against the fastest slice shown.
- **The Games page comes from history too** (`packages/core/src/games.ts`): a game's sessions are its windows joined across at most one window without it; typical and peak use the same part as the home charts. Notes appear only when the history backs them: a game runs hotter or cooler than the others (at least 4°C apart, an hour of each), its peak came within 6°C of the safe limit, or its latest sessions run at least 3°C warmer than its earliest (four sessions or more). Frame rates and settings show only for games the client has measurements for; the demo's are marked as samples.
- **Server database is Postgres (Neon), not Cloudflare D1.** D1 stops at 10 GB per database and is meant to be split per user; one Postgres database can keep growing. Accounts stay in Rig's own database with Better Auth, so there's no per-user cost for sign-in.
- **Sign-in token in Windows Credential Manager**, not in a file.
- **Desktop sign-in through the browser** with a short code (OAuth device flow), so the app never handles a password.
- **Installer:** NSIS, installed for the current user (no admin prompt to install).
- **Helper ships self-contained** (no .NET install needed), about 70 MB.
- **Windows CI job runs on main and by hand** because Windows minutes count double on private repos.

## What's tested

Tested here (Linux, no Windows):

- Core logic: health checks, the fix catalog, the PC view, LocalClient's apply, undo, redo, rollback on failure, history and upload, and the home charts' insights (days, evening sessions, fan slices, time zones and daylight saving, empty and partial history), and the games library (ranking, sessions, notes only when the data supports them), and recordings (cleaning what the helper sends, the recorder from start to finish including a restart mid-recording, and the summary) (`pnpm --filter @rig/core test`).
- Server: sign-up, the desktop's code sign-in from start to bearer token, CORS for the app, upload and read-back, privacy between accounts, which name wins, offline after 12 minutes, and chat with a stand-in for Claude: streamed text, a proposal checked against the PC, refusing changes that don't exist on the PC, steps, the daily limit, and recordings: asking for one from the chat, the desktop picking it up, upload, reading the summary back, stopping, limits, and other accounts not seeing them (`pnpm --filter @rig/server test`, on real Postgres running in memory through PGlite). The Worker was also run with `wrangler dev` against a local Postgres 16 after the migration script: sign-up, the desktop's code sign-in to a bearer token, upload, re-upload, renaming on the web, listing, history and chat's not-set-up message all worked.
- Screens: every page renders, the account sits at the bottom of the sidebar, a change goes through review before it's made and can be undone, the Games page lists, opens and asks about a game and says plainly when nothing was played, the Logs page filters events and opens a recording, and the chat starts one and reads it back (`pnpm --filter @rig/ui test`, jsdom with the 3D scene stubbed).
- Desktop Rust: the store and the helper protocol over an in-memory pipe (`cargo test`). The Windows-only launch code type-checks for Windows.
- The helper compiles; the website and the desktop front end build.

Not tried yet:

- Chat against the real Claude API (needs the API key on the server), including whether Claude picks the recording tools at the right moments.
- The helper's `events` and `processes` on real Windows: the event log queries, per-app graphics card use, and the notification when a recording ends. The parts that don't need Windows were run on Linux.
- Google sign-in (needs a Google OAuth client).

Needs a Windows PC to try:

- The admin prompt, the pipe handshake and every reading from the helper.
- Each fix and its undo on real settings (especially refresh rate and visual effects).
- The installer, and how the app looks in its real window.
