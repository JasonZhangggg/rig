# How Rig is built

## The pieces

```
 Website (apps/web)            Desktop app (apps/desktop, Tauri)
   CloudClient                   LocalClient ──────────────┐
      │                              │   Rust: SQLite store, keychain token
      │ cookie                       │ bearer token        │ named pipe (private)
      ▼                              ▼                     ▼
   Rig server (apps/server) ◄── sync ──┘            RigHelper.exe (admin)
   accounts · PC snapshots · chat · manuals         LibreHardwareMonitor · WMI · fixes
```

Both apps mount the same `RigApp` from `packages/ui` and differ only in the client they pass in. Every client implements one interface, `RigClient` (`packages/core/src/client.ts`):

- `DemoClient`: two made-up PCs in memory, each following a weekly schedule of work, evening games and background tasks. Powers the website's demo and the UI tests.
- `LocalClient`: this PC, through the helper. History and the change log are kept on disk. When signed in it uploads a snapshot every five minutes and after each change, and reaches the account's other PCs through the server.
- `CloudClient`: the website. Reads what each PC uploaded. It can't make changes; those happen in the app on the PC itself.

The PC view the screens draw is built by one function, `buildPC` (`packages/core/src/view.ts`), from the helper's raw readings. The desktop runs it live and uploads the result, so the website shows exactly what the app shows.

## The server

`apps/server` is one Cloudflare Worker (Hono) with a Postgres database (Neon in production, reached through Cloudflare Hyperdrive with its query cache turned off; queries go through Kysely, which Better Auth uses too). Each request opens its own connection pool and closes it after the response. It serves the website's files and, under `/api`:

- **Accounts** with [Better Auth](https://better-auth.com): email and password on the website, Google when it's configured, and the desktop sign-in. Sign-in attempts are limited per caller, by the address Cloudflare puts in `cf-connecting-ip`; the counts are kept in the database so they hold across Worker instances. The desktop asks for a code (`/api/auth/device/code`) and opens `/app/?user_code=…`, where the person checks the code and approves. The app then gets a bearer token, kept in Windows Credential Manager.
- **PCs**: the desktop uploads its view, settings, change log and new history points (`PUT /api/machines/:id/sync`). The website reads them back. A PC is keyed by account and machine id, and counts as online when it synced in the last 12 minutes. Name and color can be changed on either side; whichever changed last wins.
- **Your data**: `GET /api/me/export` downloads the account's PCs with all their history, recordings, the list of their manuals (not the page text) and chat use as one JSON file (shaped by `makeExport` in `packages/core/src/export.ts`, the same file the desktop app makes for this PC when signed out). `DELETE /api/me` with `{ "confirm": "DELETE" }` removes the account, its PCs, history, recordings, manuals and their pages, chat use, desktop sign-in codes and sign-ins in one transaction.
- **Chat** (`POST /api/chat`, streamed): Claude (`claude-opus-5-5`) gets the PC's readings and settings and the list of its manuals, searches the manuals Rig has read (see Manuals), can search the web for maker pages, and has two tools for changes. `propose_change` shows a fix card; the server checks it against the fix catalog and against what's actually on that PC (the power plan, startup app or display has to exist) before the person sees it. `show_steps` shows numbered steps for things only the person can do. One card per answer, and nothing changes until the person approves in the app on that PC. Each account gets a daily allowance of questions.

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

CPU temperatures and motherboard fans need LibreHardwareMonitor's PawnIO driver. Graphics cards, drives and batteries read without it. The installer installs PawnIO (a pinned, signature-checked copy) and uninstalling Rig removes it only if Rig put it there.

Each call to the helper has 20 seconds, one at a time. A call that runs out returns an error; three in a row and the app restarts the helper. A WMI query inside the helper gives up after 5 seconds.

## Starting up, and the logs

`LocalClient.start()` (`packages/core/src/local.ts`) reads the PC in named steps: saved data, parts, settings, saved history, then the first sensor reading. Settings are allowed to fail; the next tick tries again. A failed start is tried again on the next call. If the first read takes more than 45 seconds the screen says which step it's stuck on and offers Try again (`STALL_MS` in `packages/ui/src/state.tsx`).

Which PC an id belongs to is only known once this PC's parts are read, so the desktop client waits for that before sending an id to this PC or to the account. The screen reopens the PC it showed last, and without that wait a saved id looked like another PC on the account.

The desktop logs to `%LOCALAPPDATA%\app.rig.desktop\logs\Rig.log` with `tauri-plugin-log`: each startup step with its time, each helper call, each server call with status and time (ids and codes left out), sensor failures and the updater. Server calls give up after 30 seconds. [development.md](development.md#when-something-goes-wrong) says how to read it.

## My PC

My PC has three tabs, each at its own address so a link or Ctrl K opens the right one. The sidebar keeps My PC highlighted on all three (`homeOf` in `packages/ui/src/components/Shell.tsx`).

- **Parts** (`#pc`, `packages/ui/src/pages/PCPage.tsx`): the 3D view with numbered labels and the parts list. Picking a part shows its readings, specs, manual and drivers. Its Upgrade tab links to the matching kind of part on Upgrades.
- **Upgrades** (`#upgrades`): see Upgrades below.
- **Manuals** (`#manuals`): see Manuals.

## Upgrades

Upgrades works like PCPartPicker, except the build is the PC you already own, so every check runs against the parts Rig read. The feature map, and where real prices would come from, is in [upgrades.md](upgrades.md).

- **The rules are in `packages/core/src/shop.ts`.** `hardwareFacts` turns the inventory into what the checks need (socket, memory type and free slots, free M.2 slots, BIOS date, typical power draw). `fitOf` gives each part one of three answers, Fits, Check first or Won't fit, with the reason. Things Windows can't see, like card length against the case, are Check first, never a guess. Power supply wattage is asked once and kept per PC on that device.
- **The catalog and every price are demo data.** `demoCatalog` has made-up shops (Northwind, Contoso Parts, Fabrikam), and every price on screen sits under a "Demo prices" label. No ratings are shown.
- **The server serves it** at `GET /api/machines/:id/shop`, built from the PC's last upload. Each client has `shop(machineId)`; the desktop asks the server.
- **The screen** (`packages/ui/src/pages/upgrades/Shop.tsx`) leads with a free fix if Rig found one, then Rig's pick, then the kinds of part that can change. A laptop only offers storage. "Your list" totals the parts you added, with the change in power draw, and is kept per PC on that device.

## Logs and recordings

When the chat can't tell what's wrong from the latest readings, it records. A recording keeps temperatures, load, fan speeds, the busiest apps and the Windows events that land while it runs, for 1 to 180 minutes. It only reads.

- **The model and the summary are in `packages/core/src/recordings.ts`.** A capture kind is one entry in the `captures` table and an event kind is one entry in `eventRules`; adding either is a table entry. `summarise` is pure: it finds sustained heat, a part pinned at full load, sudden drops and each Windows event, with the readings around it. The Logs screen and the chat both read that one summary, so the charts and Claude's answer agree.
- **The desktop runs it** (`recorder.ts`). It saves as it goes, so a recording survives the app closing or the PC crashing, which is often the thing being recorded, and it reads the event log when time is up. The newest 20 stay on the PC.
- **The chat has two tools**, `start_recording` and `read_recording`. On the desktop the recording starts at once. From the website the server stores the request and the desktop picks it up on its next upload, up to about five minutes later; the chat says so. When it finishes, the desktop uploads it, shows a Windows notification, and the chat offers "See what Rig found".
- **The server keeps them per account and PC** (`0003_recordings.sql`): the 20 newest for 90 days, one running at a time, and a request nobody picked up in a day is closed.
- **The Logs screen** has two views, each with its own address: Events (`#logs`, `packages/ui/src/pages/Logs.tsx`) and Performance (`#history`, `pages/History.tsx`). The Games view (`#games`) is no longer a tab; Ctrl K still opens it. Events lists Windows events by day with a kind filter, the recordings, and one recording with its charts, what Rig found marked on them, and "Ask about this". Performance is laid out like Task Manager's Performance tab with HWMonitor's sensor list: a list of parts down the side (processor, graphics card, memory, storage, motherboard, fans), each with its reading now and a sparkline, and for the picked part its figures (highest moment, when busy, at rest), a chart per reading (temperature against the safe limit, usage, memory in use, fastest fan) over Live, Day, Week or Month, and every sensor it reports with now, lowest and highest. Each history point keeps processor and graphics load and memory in use (averaged over the window) and the warmest drive and motherboard temperature (`HistoryWindow` in `packages/core/src/history.ts`, columns added by migration `0005_history_parts.sql`). The sensors come from `PC.readings`, built by `buildPC`; Live draws `livePoint(pc)` as each update arrives, for the last five minutes the page was open. Each part opens with the few readings worth a glance (`keyReadings` in `packages/core/src/sensors.ts`, a rule table per part matched against LibreHardwareMonitor's sensor names: package, hottest and fastest core, power and core voltage for the processor; core, hot spot, video memory, clock, power and fan for the graphics card; temperature, life used and transfer rates for drives; socket, power delivery, chipset and rail voltages for the motherboard). The processor also gets a tile per core (`coresOf`: load, each thread, clock, temperature and power, P-cores before E-cores), and the full sensor list sits behind a Show all button once a part has more than ten. When the helper runs without admin rights or without the PawnIO driver (`needs-admin` or `needs-driver` in `pc.issues`), the processor, motherboard and fans pages say which readings are missing. The helper forwards every LHM sensor type the screens use, including drive throughput and current since 0.1.4; network adapters are not read.

## Manuals

Rig keeps the maker's own manual for each part (motherboard, laptop, graphics card, and parts the person names: case, power supply, cooler, memory, monitor, drive), finds the pages with useful diagrams, and lets the chat quote them by page. Each part's Manual tab on My PC finds, adds and opens its manual. The Manuals tab of My PC (`#manuals`, `packages/ui/src/manuals/ManualsTab.tsx`) searches every manual at once, shows one card per part, adds manuals for things Windows can't see (a monitor, the case), and lists each driver and BIOS with the maker's download page. Rig never installs them. Ctrl K also finds manuals, diagram pages and any page whose words match. The shared shapes are in `packages/core/src/manuals.ts`; the server's API is listed in `packages/core/src/api.ts`.

1. **Finding** (`POST /api/machines/:id/manuals/find`, `apps/server/src/manuals.ts`). The server first checks `manual_sources`, a cache shared by every account keyed by kind, maker and model (a manual's address is public, so two people with the same board don't both pay for a search). A miss is remembered for 7 days. Otherwise Claude looks with web search (5 uses) and web fetch (3), and answers with one `report_manual` call: found or not, the PDF's address and its title.
2. **Checking.** An address is used only when it's https with no user name or port, its host is the maker's own domain or a subdomain (one table of makers and their domains; for a maker not in it, the site's own name has to contain the maker's), and the file starts with `%PDF`. Each redirect is checked the same way. When an address fails, Claude is told why and may try another, a few times at most. A lookup that asks Claude counts as one of the day's chat questions; a cache hit is free.
3. **Downloading** (`GET …/manuals/:mid/pdf`). The app gets the PDF through the server, so it works whatever the maker's site allows. The address comes from the database, never from the request, and is checked against the maker again before every download. More than 60 MB is refused, by its size up front and by counting while it streams. If the maker's address is gone or no longer a PDF, the cache forgets it so the next lookup searches again. A PDF the person adds from their own files only has its details sent (`POST …/manuals`); the file stays on that device.
4. **Reading.** The app keeps a copy on the device, reads each page's text with pdf.js, marks the diagram pages, and sends the text back (`PUT …/pages`, up to 8 MB, the one route allowed more than 2 MB). The server keeps up to 600 pages of 6,000 characters, replacing the manual's old pages in one transaction. One manual per part: finding or adding again for the same part replaces the old one and its pages.
5. **Searching** (`GET …/manuals/search`, `0004_manuals.sql`). Postgres full-text search over each page's words twice: stemmed English, so "how do I connect the front panel" finds "connect the front panel switches", and word for word, so header names like F_PANEL, CPU_FAN, JRGB1 and M2_1 match exactly. A page matches either; best matches come first with a short snippet, matched words marked « ».
6. **In the chat.** The PC block lists each manual (part, title, page count, whether it's read, its diagram pages). The `search_manuals` tool returns the 4 best pages with about 1,500 characters of each, and each becomes a source that opens that page inside Rig (`rig:manual/<id>#page=<n>`). Claude is told to search a read manual first and say which page the answer is on, and, for a part with no manual yet, that it can be added on the part's Manual tab in My PC. Web search stays for everything else.

## Defaults chosen

- **Monorepo with pnpm workspaces.** The website and the app share every screen.
- **Desktop data in SQLite** in the app's data folder; history keeps 90 days, one point per ten minutes with the highest temperatures and fan speed in that window, whether it was busy, and the game in front for most of it.
- **Home charts come from history** (`packages/core/src/insights.ts`), in the viewer's local days. Idle is the processor's median while nothing heavy ran; typical and peak are the graphics card's busy median and highest reading (the processor's on a laptop or a desktop without graphics card readings). An evening runs 6 PM to 6 AM; a session is busy windows joined across at most one quiet window, and it ran hot when a part came within 6°C of its safe limit. Fans show the fastest speed per six-hour slice against the fastest slice shown.
- **The Games view comes from history too** (`packages/core/src/games.ts`): a game's sessions are its windows joined across at most one window without it; typical and peak use the same part as the home charts. Notes appear only when the history backs them: a game runs hotter or cooler than the others (at least 4°C apart, an hour of each), its peak came within 6°C of the safe limit, or its latest sessions run at least 3°C warmer than its earliest (four sessions or more). Frame rates and settings show only for games the client has measurements for; the demo's are marked as samples.
- **Server database is Postgres (Neon), not Cloudflare D1.** D1 stops at 10 GB per database and is meant to be split per user; one Postgres database can keep growing. Accounts stay in Rig's own database with Better Auth, so there's no per-user cost for sign-in.
- **Alerts** (`packages/core/src/alerts.ts`) are a table of rules over the live readings and the last 30 days of history: a part at its safe limit for two minutes, a fan that spun earlier reading 0 rpm while its part is hot, a drive under 10% free or under 20% of its life left, and a part running at least 5°C warmer in a game than in the same game two to four weeks ago. Whoever owns the live feed (the desktop, the demo) tracks them, so a problem has to last its rule's hold time, survives a two-minute dip, and keeps its start time if it comes back within 30 minutes. They ride on the PC view, so the website shows what the desktop saw. The desktop sends a Windows notification for a new one while its window isn't focused, at most once per alert every six hours. Each kind can be turned off per device, in the Notifications section of Settings, and the Health summary counts only the kinds left on. Like the findings, alert text is written in °C (a difference as a bare "5°") and shown in the unit the viewer picked.
- **Sign-in token in Windows Credential Manager**, not in a file.
- **Desktop sign-in through the browser** with a short code (OAuth device flow), so the app never handles a password.
- **Installer:** NSIS, installed for the current user (no admin prompt to install).
- **Helper ships self-contained** (no .NET install needed), about 70 MB.
- **Windows CI job runs on main and by hand** because Windows minutes count double on private repos.

## What's tested

Tested here (Linux, no Windows):

- Core logic: health checks, the fix catalog, the PC view, LocalClient's apply, undo, redo, rollback on failure, history and upload, and the home charts' insights (days, evening sessions, fan slices, time zones and daylight saving, empty and partial history), and the games library (ranking, sessions, notes only when the data supports them), and recordings (cleaning what the helper sends, the recorder from start to finish including a restart mid-recording, and the summary), and upgrades (what Rig reads from the inventory, each fit rule, laptops, power supply sizing and demo prices) (`pnpm --filter @rig/core test`).
- Server: sign-up, the desktop's code sign-in from start to bearer token, CORS for the app, upload and read-back, privacy between accounts, which name wins, offline after 12 minutes, and chat with a stand-in for Claude: streamed text, a proposal checked against the PC, refusing changes that don't exist on the PC, steps, the daily limit, and recordings: asking for one from the chat, the desktop picking it up, upload, reading the summary back, stopping, limits, and other accounts not seeing them, and manuals: finding one with stand-ins for Claude and the maker's site (a host that isn't the maker's, look-alike domains, redirects off the site and pages that aren't PDFs are refused), the shared cache and the week-long miss cache, the daily allowance, the PDF download (not a PDF, too big up front or while streaming), saving and searching pages (plain questions and header names), one manual per part, privacy between accounts and the chat quoting a page as a Manual source (`pnpm --filter @rig/server test`, on real Postgres running in memory through PGlite). The Worker was also run with `wrangler dev` against a local Postgres 16 after the migration script: sign-up, the desktop's code sign-in to a bearer token, upload, re-upload, renaming on the web, listing, history and chat's not-set-up message all worked.
- Settings: temperatures in °C or °F (`formatTemp` in `packages/core/src/units.ts`), the data download from the demo, deleting only after DELETE is typed, starting with Windows (`pnpm --filter @rig/ui test`). On the server, the export holds only the account's own data (recordings, Windows events and the list of manuals included, but no manual page text), and deleting removes every one of the account's rows, leaves another account's untouched and rolls back as a whole if any part fails.
- Screens: every page renders, the account sits at the bottom of the sidebar, a change goes through review before it's made and can be undone, the Games view lists, opens and asks about a game and says plainly when nothing was played, the Logs page filters events and opens a recording, the chat starts one and reads it back, My PC's tabs open at their own addresses, Upgrades shows fit, prices labeled as demo, the power supply question and the list, and the Manuals tab searches and opens a page (`pnpm --filter @rig/ui test`, jsdom with the 3D scene stubbed).
- Desktop Rust: the store and the helper protocol over an in-memory pipe (`cargo test`). The Windows-only launch code type-checks for Windows.
- The helper compiles; the website and the desktop front end build.

Not tried yet:

- Chat against the real Claude API (needs the API key on the server), including whether Claude picks the recording tools at the right moments.
- Finding manuals against the real Claude API and real maker sites: how often Claude finds the right PDF, and whether the makers' download servers answer a Worker (some sit behind bot checks or send files from other domains, which Rig refuses).
- The helper's `events` and `processes` on real Windows: the event log queries, per-app graphics card use, and the notification when a recording ends. The parts that don't need Windows were run on Linux.
- Google sign-in (needs a Google OAuth client).

Needs a Windows PC to try:

- The admin prompt, the pipe handshake and every reading from the helper.
- Each fix and its undo on real settings (especially refresh rate and visual effects).
- The installer, and how the app looks in its real window.
