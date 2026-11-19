# Rig

Rig is a PC helper app. It shows your computer as a 3D model you can click into, explains what's wrong in plain words, answers questions from your parts' own manuals, and fixes things for you, always asking first and keeping a one-tap undo for every change.

Windows comes first. The website shows every PC on your account from any device.

## Status

Being built. What works today, and what still needs a Windows PC to try, is listed in [docs/architecture.md](docs/architecture.md#whats-tested).

## Run it

On Windows, [docs/development.md](docs/development.md) covers setup, running the real app and reading its logs. In short, with Node, Rust, the .NET 8 SDK and pnpm installed:

```
pnpm install
pnpm desktop        # the desktop app against the live server; builds the helper first
pnpm dev:web        # website and demo at http://localhost:5173 (demo: /app/?demo), any OS
pnpm dev:server     # the API at http://localhost:8787 (first time: see docs/deploy.md)
pnpm test           # all tests
pnpm typecheck      # types in every package
```

On a Mac or Linux, `pnpm desktop` runs the app on a simulated PC.

Building the Windows installer: Actions, CI, Run workflow, then download `rig-windows-installer`. Releasing and the auto-updater: [docs/releasing.md](docs/releasing.md). Putting the server online: [docs/deploy.md](docs/deploy.md). How it fits together: [docs/architecture.md](docs/architecture.md). Notes for Claude Code: [CLAUDE.md](CLAUDE.md).

## Layout

| Folder | What it is |
| --- | --- |
| `packages/core` | Data shapes, health checks, the fix catalog, and the clients the screens talk to |
| `packages/ui` | Every screen, shared by the desktop app and the website |
| `apps/web` | The website: landing page, demo and your PCs |
| `apps/desktop` | The Tauri app: starts the helper, keeps history and the change log on disk |
| `helper/RigHelper` | The C# helper that reads sensors and makes changes, with admin rights |
| `apps/server` | Accounts, sync between the app and the website, and chat |

## Stack

- **Server:** one Cloudflare Worker (Hono) with Postgres (Neon, through Hyperdrive), Better Auth for accounts, and the Claude API for chat. See [docs/deploy.md](docs/deploy.md).
- **Desktop:** [Tauri](https://tauri.app) 2 with a thin Rust core. The screens and logic are TypeScript and React, shared with the website.
- **3D:** three.js.
- **Hardware on Windows:** a C# helper built on [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor). It's the only part with admin rights.
- **Frame rates:** PresentMon, later. Rig never injects into games, so anti-cheat isn't an issue.
