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

- `DemoClient`: two made-up PCs in memory. Powers the website's demo and the UI tests.
- `LocalClient`: this PC, through the helper. History and the change log are kept on disk. When signed in it uploads a snapshot every five minutes and after each change, and reaches the account's other PCs through the server.
- `CloudClient`: the website. Reads what each PC uploaded. It can't make changes; those happen in the app on the PC itself.

The PC view the screens draw is built by one function, `buildPC` (`packages/core/src/view.ts`), from the helper's raw readings. The desktop runs it live and uploads the result, so the website shows exactly what the app shows.

## Changes are safe by construction

1. Every change Rig can make is in one list, the fix catalog (`packages/core/src/actions.ts`): power plan, startup apps, Game Mode, visual effects, processor speed cap, screen refresh rate. Chat can only propose calls from this list, and they're checked with `validateCall` on the server, in the app and again in the helper.
2. Before anything changes, the app reads the current values and shows a before and after table. Nothing happens until the person confirms.
3. The helper reads each old value before writing the new one and returns the call that puts it back. That undo call is stored in the change log with the change.
4. If one step of a multi-step change fails, the steps before it are put back, and the person is told nothing changed.
5. Undo replays the stored undo calls in reverse order. Redo replays the originals.

Rig never installs drivers, overclocks or touches games.

## The helper

`helper/RigHelper` is a .NET 8 program. The app starts it once through the Windows admin prompt (`ShellExecuteEx` with `runas`). If the person says No, it starts without admin rights and Rig shows which readings are missing.

Talking to it stays private: the app makes a named pipe with a random name that takes one connection, then checks the connected process is the helper it started. The helper checks the pipe belongs to its parent and quits when the app does. Requests are JSON, one per line: `hello`, `inventory`, `facts`, `snapshot`, `apply`.

`RigHelper.exe --selftest out.json` reads everything once and writes it to a file. CI runs this on a Windows runner.

CPU temperatures and motherboard fans need LibreHardwareMonitor's PawnIO driver. Graphics cards, drives and batteries read without it. The installer doesn't add PawnIO yet (see open questions).

## Defaults chosen

- **Monorepo with pnpm workspaces.** The website and the app share every screen.
- **Desktop data in SQLite** in the app's data folder; history keeps 90 days, one point per ten minutes with the highest temperatures in that window.
- **Sign-in token in Windows Credential Manager**, not in a file.
- **Desktop sign-in through the browser** with a short code (OAuth device flow), so the app never handles a password.
- **Installer:** NSIS, installed for the current user (no admin prompt to install).
- **Helper ships self-contained** (no .NET install needed), about 70 MB.
- **Windows CI job runs on main and by hand** because Windows minutes count double on private repos.

## What's tested

Tested here (Linux, no Windows):

- Core logic: health checks, the fix catalog, the PC view, LocalClient's apply, undo, redo, rollback on failure, history and upload (`pnpm --filter @rig/core test`).
- Screens: every page renders, the account sits at the bottom of the sidebar, a change goes through review before it's made and can be undone (`pnpm --filter @rig/ui test`, jsdom with the 3D scene stubbed).
- Desktop Rust: the store and the helper protocol over an in-memory pipe (`cargo test`). The Windows-only launch code type-checks for Windows.
- The helper compiles; the website and the desktop front end build.

Needs a Windows PC to try:

- The admin prompt, the pipe handshake and every reading from the helper.
- Each fix and its undo on real settings (especially refresh rate and visual effects).
- The installer, and how the app looks in its real window.
