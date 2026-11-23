//! Installing and uninstalling, on a thread of their own while the window
//! shows how it's going. Both run Tauri's own NSIS installer or uninstaller
//! silently, so everything Rig's installer does (its hooks, the registry,
//! shortcuts) stays exactly as it is.

use std::ffi::OsString;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use crate::payload::{self, Payload};
use crate::progress::{Look, Step, Tracker};
use crate::sys::{self, Installed};

pub struct Done {
    /// The background recorder isn't installed (its Windows prompt was refused).
    pub recorder_off: bool,
}

/// Watches `child` until it exits, telling `notify` where the bar is. Returns its exit code.
fn watch(mut child: Child, mut tracker: Tracker, files: impl Fn(f64) -> f64, notify: &impl Fn(Step, f64)) -> std::io::Result<i32> {
    let start = Instant::now();
    let mut changed = start;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status.code().unwrap_or(-1));
        }
        let before = tracker.step;
        let prompt = sys::running().iter().any(|n| n == "consent.exe");
        let (step, p) = tracker.look(Look { files: files(start.elapsed().as_secs_f64()), prompt, since: changed.elapsed().as_secs_f64() });
        if step != before {
            changed = Instant::now();
        }
        notify(step, p);
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn failed(code: i32, installing: bool) -> String {
    if installing {
        format!("Setup stopped before Rig finished installing (code {code}). Close Rig if it's open and try again. If it happens again, restart the PC, then try once more.")
    } else {
        format!("Setup stopped before Rig was removed (code {code}). Close Rig if it's open and try again. If it happens again, restart the PC, then try once more.")
    }
}

/// Installs or updates Rig from the installer inside `exe`.
pub fn install(exe: &Path, p: &Payload, tmp: &Path, before: Option<&Installed>, desktop: bool, notify: impl Fn(Step, f64)) -> Result<Done, String> {
    let installer = tmp.join(format!("Rig_{}_x64-setup.exe", p.meta.version));
    payload::extract(exe, p, &installer).map_err(|e| format!("Setup couldn't unpack Rig: {e}"))?;
    let dir = before.map_or_else(sys::default_dir, |b| b.dir.clone());
    let shortcut = sys::desktop().map(|d| d.join("Rig.lnk"));
    let had_shortcut = shortcut.as_ref().is_some_and(|s| s.exists());

    // A first install fills an empty folder, so its size says how far along it is.
    // An update rewrites files that are already there, so it goes by time instead.
    let fresh = before.is_none() && sys::folder_size(&dir) == 0;

    let mut cmd = Command::new(&installer);
    cmd.arg("/S");
    // An update keeps the person's shortcuts as they left them.
    if before.is_some() {
        cmd.arg("/UPDATE");
    }
    let child = cmd.spawn().map_err(|e| format!("Setup couldn't start Rig's installer: {e}"))?;

    let size = p.meta.size.max(1) as f64;
    let expected = (p.len as f64 / 25e6).max(3.0);
    let files = |secs: f64| if fresh { sys::folder_size(&dir) as f64 / size } else { secs / expected };
    let code = watch(child, Tracker::install(), files, &notify).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&installer);
    let code = code?;
    if code != 0 {
        return Err(failed(code, true));
    }
    if before.is_none() && !desktop && !had_shortcut {
        if let Some(s) = shortcut {
            let _ = std::fs::remove_file(s);
        }
    }
    Ok(Done { recorder_off: !sys::recorder_installed() })
}

/// Uninstalls the Rig in `dir`, and this PC's readings and settings too when `wipe`.
pub fn uninstall(dir: &Path, wipe: bool, notify: impl Fn(Step, f64)) -> Result<(), String> {
    let un = dir.join("uninstall.exe");
    if !un.exists() {
        return Err(format!("Rig's uninstaller isn't in {}. Rig may already be gone.", dir.display()));
    }
    // `_?=` keeps NSIS from copying itself elsewhere first, so setup can wait for it. It must come last, unquoted.
    let mut at = OsString::from("_?=");
    at.push(dir.as_os_str());
    let child = Command::new(&un).arg("/S").raw_arg(&at).spawn().map_err(|e| format!("Setup couldn't start Rig's uninstaller: {e}"))?;
    let code = watch(child, Tracker::uninstall(), |secs| secs / 4.0, &notify).map_err(|e| e.to_string())?;
    if code != 0 {
        return Err(failed(code, false));
    }
    // Run in place, the uninstaller can't delete itself.
    let _ = std::fs::remove_file(&un);
    let _ = std::fs::remove_dir(dir);
    if wipe {
        // What the stock uninstaller's "Delete the application data" box removes.
        for d in [sys::app_data(), sys::local_app_data()] {
            let _ = std::fs::remove_dir_all(d.join("app.rig.desktop"));
        }
    }
    Ok(())
}

/// Runs Tauri's installer with NSIS flags the caller gave (`/S`, `/P /UPDATE`, ...), with no window of setup's own.
pub fn quiet_install(exe: &Path, p: &Payload, tmp: &Path, flags: &str) -> i32 {
    let installer = tmp.join(format!("Rig_{}_x64-setup.exe", p.meta.version));
    if payload::extract(exe, p, &installer).is_err() {
        return 2;
    }
    let code = Command::new(&installer).raw_arg(flags).status().map_or(2, |s| s.code().unwrap_or(2));
    let _ = std::fs::remove_file(&installer);
    code
}

/// Runs uninstall.exe with NSIS flags, as Tauri's reinstall page does (`/P _?=<folder>`).
pub fn quiet_uninstall(here: &Path, flags: &str) -> i32 {
    let dir = flags
        .find("_?=")
        .map(|i| PathBuf::from(flags[i + 3..].trim()))
        .unwrap_or_else(|| here.to_path_buf());
    Command::new(dir.join("uninstall.exe")).raw_arg(flags).status().map_or(2, |s| s.code().unwrap_or(2))
}

/// Runs a program and waits, for when this PC can't show setup's window.
pub fn plain(program: &Path) -> i32 {
    Command::new(program).status().map_or(2, |s| s.code().unwrap_or(2))
}
