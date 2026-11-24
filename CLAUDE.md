# Rig

A Windows PC helper: a Tauri desktop app with a C# helper that reads sensors with admin rights, a website that shows every PC on the account, and a Cloudflare Worker server. The website and the app share every screen. Start with [docs/architecture.md](docs/architecture.md); Windows setup and debugging are in [docs/development.md](docs/development.md), and the Upgrades tab's features and price sources in [docs/upgrades.md](docs/upgrades.md).

## Commands

Run from the repo root in PowerShell (not WSL).

```
pnpm install
pnpm desktop                            # the real app on this PC, against the live server
pnpm test                               # every TypeScript test (Postgres runs in memory)
pnpm typecheck
pnpm --filter @rig/core test            # one package; add -- -t "name" for one test
pnpm --filter @rig/ui test
pnpm --filter @rig/server test
cd apps/desktop/src-tauri; cargo test   # Rust store and helper protocol
dotnet build helper/RigHelper           # the helper
```

Before saying a change works, run the tests for the packages it touches and `pnpm typecheck`. For anything the person sees on Windows, run `pnpm desktop` and check the real window, and read the log.

## Debugging the app

- Log: `%LOCALAPPDATA%\app.rig.desktop\logs\Rig.log`. Read the last lines with `Get-Content "$env:LOCALAPPDATA\app.rig.desktop\logs\Rig.log" -Tail 80`. The prefixes are `start:` (first read, per step), `helper:`, `server:`, `sensors:` and `update:`.
- The helper alone: `Start-Process -Wait -Verb RunAs apps\desktop\src-tauri\binaries\RigHelper-x86_64-pc-windows-msvc.exe -ArgumentList "--selftest", "$PWD\rig-selftest.json"`. It's a windowed exe, so it needs `-Wait`.
- New log lines in TypeScript go through the `log` option on `LocalClient` and `CloudClient` (`Log` in `packages/core/src/client.ts`); in Rust, the `log` crate.

## Where things are

- `packages/core`: data shapes, `buildPC` (the PC view), health checks, alerts, the fix catalog (`actions.ts`), recordings, and the three clients behind the `RigClient` interface: `LocalClient` (desktop), `CloudClient` (website and the account), `DemoClient` (demo and UI tests).
- `packages/ui`: every screen. `state.tsx` holds app state; `App.tsx` routes. The Logs screen's Performance view (`pages/History.tsx`) is the per-part charts and sensors; its sensor names and grouping are in `packages/core/src/sensors.ts`.
- Interface conventions in `packages/ui`: headings use the type tokens in `styles/tokens.css` (`--t-page`, `--t-title`, `--t-figure`, `--t-label`); hover styles sit inside `@media (hover: hover) and (pointer: fine)`; dialogs use `useModal` and menus or tabs `arrowKeys` from `components/modal.ts`. On phones (760px and under) the sidebar hides behind a menu button and opens full screen (`components/Sidebar.tsx`).
- `apps/desktop`: Tauri. `src-tauri/src/helper.rs` starts the helper and talks to it over a named pipe; `src/main.tsx` wires the client to the host.
- `helper/RigHelper`: .NET 8 and LibreHardwareMonitor. Reads sensors, applies fixes, runs the background recorder and installs PawnIO.
- `apps/server`: Hono on Cloudflare Workers, Postgres via Hyperdrive (query cache off), Better Auth. SQL migrations in `apps/server/migrations`.
- `apps/setup`: Rig Setup, the Rig-styled window that installs, updates by hand and uninstalls Rig around Tauri's NSIS installer (`tools/setup.mjs` builds and packs it). See its README for what Windows still shows itself.
- `tools/`: `desktop.mjs` (behind `pnpm desktop`), `version.mjs` (one version across every package), `pawnio.mjs`, `setup.mjs`.

## Rules

- Never commit secrets. Server secrets live in GitHub Actions secrets and Cloudflare.
- Every change Rig makes to a PC is previewed with its current values, approved in the app, snapshotted, verified, and undone where possible; what can't be undone says so. Tiers, the never list and refusals come from the shared rules (`packages/core/src/rules/commands.json`, and `rules/gpu.json` for graphics settings) and Rig's own code, never from the model, checked on the server, in the app and again in the helper. Don't add a way around that.
- Deploying the server (pushing to the `deploy` branch) and releasing (`docs/releasing.md`) change what people use. Ask Jason first.
- Change the version only with `pnpm version:set X`, so every file agrees.
- Words on screen are plain and short, say what happened and what to do next, and never blame the person.
- Tests check what someone using Rig would see, not internals. A bug fix comes with a test that fails without it.
- CI runs `check` on every pull request. The Windows job runs on `main`, or by hand: `gh workflow run ci.yml --ref <branch>`.
