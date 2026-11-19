# Working on Rig on Windows

Rig reads sensors through Windows, so the real app only runs on Windows. Use PowerShell or Windows Terminal, not WSL: `pnpm desktop` stops straight away inside WSL.

## Set up once

Install these, then open a new terminal so it finds them:

```
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Microsoft.DotNet.SDK.8
winget install Git.Git
corepack enable
```

- **Node** 20 or newer. `corepack enable` gives you the pnpm version the repo asks for (`packageManager` in `package.json`).
- **Rust** with the Visual Studio C++ build tools, for the Tauri app.
- **.NET 8 SDK**, for the helper. The repo's `nuget.config` points at nuget.org, so a machine with no NuGet source set up still restores.
- **PawnIO**, for CPU temperatures and motherboard fans. Installing Rig once installs it. Without it, Rig still runs and says which readings are missing.

Then, in the repo folder:

```
pnpm install
pnpm desktop
```

## Day to day

| Command | What it does |
| --- | --- |
| `pnpm desktop` | Builds the helper when its code changed, then starts the app. Screen changes show live. It signs in to the live server; set `VITE_RIG_API` to use another. |
| `pnpm dev:web` | The website and demo at http://localhost:5173 (demo: `/app/?demo`). Works on any OS. |
| `pnpm dev:server` | The API at http://localhost:8787. Needs a local Postgres; see [deploy.md](deploy.md#running-it-locally). |
| `pnpm test` | Every TypeScript test. Postgres runs in memory, so nothing else is needed. |
| `pnpm typecheck` | Types in every package. |
| `cargo test` in `apps/desktop/src-tauri` | The Rust store and helper protocol tests. |

After a `git pull`, run `pnpm install` before `pnpm desktop`. Restart `pnpm desktop` after changing Rust code. A change to the helper is picked up on the next start.

## When something goes wrong

**Rig.log.** The app writes a log at `%LOCALAPPDATA%\app.rig.desktop\logs\Rig.log` (Settings, About, Open logs folder). It keeps three files of 2 MB. The last lines:

```
Get-Content "$env:LOCALAPPDATA\app.rig.desktop\logs\Rig.log" -Tail 80
```

Each line says where it came from:

- `start:` is each step of the first read, timed. A step that never says "took" is where Rig is stuck. After 45 seconds the screen names that step too.
- `helper:` is the helper being started (with or without admin) and each call to it. The sensor reading every few seconds (`snapshot`) only shows when it takes a second or more, or fails.
- `server:` is each call to the Rig server with its status and time. Ids and codes are left out.
- `sensors:` is when readings stop or come back. `update:` is the auto-updater, which only runs in installed builds.

`pnpm desktop` prints the same lines in its terminal.

**The helper on its own.** `RigHelper.exe --selftest out.json` reads everything once and writes it to a file. It's a windowed program, so PowerShell needs `-Wait`:

```
Start-Process -Wait -Verb RunAs apps\desktop\src-tauri\binaries\RigHelper-x86_64-pc-windows-msvc.exe -ArgumentList "--selftest", "$PWD\rig-selftest.json"
```

Drop `-Verb RunAs` to see what it reads without admin rights.

**How the helper runs.** The app starts the helper once, through the Windows admin prompt. If the person says No, the helper runs without admin rights, and CPU temperatures and some fans are missing. The two talk over a private named pipe. Each call has 20 seconds. A call that runs out returns an error, and three in a row restart the helper. Calls go one at a time.

**Known fixes.** `NU1100` on restore was a machine with no NuGet source; `nuget.config` fixes it. Vite crashing with `EBUSY` on `src-tauri\target` was the file watcher; `vite.config.ts` now ignores `src-tauri`. If either comes back, check those two files.
