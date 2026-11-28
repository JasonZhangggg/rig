# Rig Setup

The window people install and uninstall Rig with, in Rig's own look instead of
the stock NSIS wizard. It's a small Rust program (tao for the window, wry for
WebView2, the same browser engine the app runs in) showing one page,
[`ui/index.html`](ui/index.html), which uses the colours, type and buttons of
`packages/ui/src/styles/tokens.css`.

It doesn't replace Tauri's installer; it runs it. That keeps the parts that
already work (the recorder service, PawnIO, shortcuts, the uninstall entry,
updates) exactly as they are.

## How it fits together

- **Download.** `Rig-Setup-X-x64.exe` on the release is `rig-setup.exe` with
  Tauri's NSIS installer appended, then `{"version","size"}` and a trailer
  (`src/payload.rs`). `node tools/setup.mjs pack` writes it. Setup shows a
  welcome (fresh install, update or reinstall), extracts the installer to the
  temp folder, runs it with `/S` (and `/UPDATE` over an existing copy), shows
  progress from the folder filling up, and ends on Open Rig.
- **Uninstall.** The installer copies plain `rig-setup.exe` into Rig's folder
  (`apps/desktop/src-tauri/windows/hooks.nsh`) and points Windows' uninstall
  entry at `rig-setup.exe --uninstall`, so Installed apps opens the same
  window. It copies itself to the temp folder first, so Rig's folder can be
  emptied, then runs `uninstall.exe /S`. "Also delete this PC's readings and
  settings" removes `%APPDATA%\app.rig.desktop` and `%LOCALAPPDATA%\app.rig.desktop`.
- **Updates from inside Rig** use the plain NSIS installer and its signature,
  with `installMode: "quiet"`, so no installer window shows at all; Rig's own
  Updates screen is the only thing people see.
- **Scripts and IT tools.** Any NSIS flag (`/S`, `/P`, `/D=`, `/NS`) goes
  straight to the installer with no window, and `QuietUninstallString` stays
  `uninstall.exe /S`.
- **No WebView2** (rare: Windows 10 and 11 ship it): the stock wizard runs
  instead, so setup always works.

## What Windows still shows itself

These belong to Windows and no app can restyle them:

- **"Windows protected your PC"** (SmartScreen), because the setup isn't
  code-signed yet. Signing it is the fix (docs/releasing.md).
- **"Do you want to allow this app to make changes?"** (UAC), once per install
  or update, for the background recorder, PawnIO and the task that starts
  Rig's helper with admin rights, so opening Rig doesn't ask again. The
  welcome screen says it's coming.
- **Notifications** in the corner of the screen, which Windows draws.
- **The WebView2 runtime's own installer**, on the few PCs without it.

## Working on it

- Preview the page in any browser: open `ui/index.html` (with `#update`,
  `#working`, `#done`, `#uninstall`, `#error` and the other names in `SAMPLES`
  at the bottom of the page). On Windows, `rig-setup.exe --preview done` shows
  it in the real window.
- `cargo test` runs the parts that don't need Windows (arguments, the payload,
  progress, versions); CI runs it in `check`. From Linux or macOS,
  `cargo check --target x86_64-pc-windows-gnu` checks the Windows code.
- CI installs with the window and uninstalls with it on `windows-latest`
  (`.github/actions/windows-installer`). `RIG_SETUP_AUTO=1` presses the main
  button and exits with 0 when it worked.
- The exe shows Rig's version (from `tauri.conf.json`) in Properties; the
  crate itself stays at 0.0.0 so `pnpm version:set` has one less file.
