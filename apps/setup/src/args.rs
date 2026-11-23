//! What rig-setup.exe was asked to do, from its command line.
//!
//! The raw text after the program name is kept for the flags it passes on to
//! Tauri's NSIS installer and uninstaller, because NSIS reads `_?=<folder>`
//! to the end of the line, spaces and all, which splitting into words breaks.

use std::path::PathBuf;

#[derive(Debug, PartialEq)]
pub enum Mode {
    /// The setup window.
    Install,
    /// NSIS flags like `/S` or `/P /UPDATE`: run the installer with them and no window of our own.
    QuietInstall(String),
    /// The uninstall window, for Rig in `dir` (or where the registry says).
    Uninstall { dir: Option<PathBuf>, from_temp: bool },
    /// NSIS flags after `--uninstall`, like Tauri's reinstall page sends (`/P _?=C:\...`): run uninstall.exe with them.
    QuietUninstall(String),
    /// One of the page's sample screens, to look at or photograph. Changes nothing.
    Preview(String),
}

/// The command line without the program's own name, as Windows' GetCommandLineW gives it.
pub fn after_program(line: &str) -> &str {
    let line = line.trim_start();
    let rest = if let Some(q) = line.strip_prefix('"') {
        q.find('"').map_or("", |i| &q[i + 1..])
    } else {
        line.find(char::is_whitespace).map_or("", |i| &line[i..])
    };
    rest.trim()
}

/// Splits our own options into words, keeping "quoted paths" whole.
fn words(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut quoted, mut any) = (Vec::new(), String::new(), false, false);
    for c in s.chars() {
        match c {
            '"' => { quoted = !quoted; any = true; }
            c if c.is_whitespace() && !quoted => {
                if any { out.push(std::mem::take(&mut cur)); any = false; }
            }
            c => { cur.push(c); any = true; }
        }
    }
    if any { out.push(cur); }
    out
}

pub fn parse(rest: &str) -> Mode {
    let rest = rest.trim();
    if let Some(after) = rest.strip_prefix("--uninstall") {
        let after = after.trim();
        if after.is_empty() || after.starts_with("--") {
            let w = words(after);
            let dir = w.iter().position(|a| a == "--dir").and_then(|i| w.get(i + 1)).map(PathBuf::from);
            return Mode::Uninstall { dir, from_temp: w.iter().any(|a| a == "--from-temp") };
        }
        return Mode::QuietUninstall(after.to_string());
    }
    if let Some(after) = rest.strip_prefix("--preview") {
        return Mode::Preview(words(after).into_iter().next().unwrap_or_else(|| "welcome".into()));
    }
    if rest.starts_with('/') {
        return Mode::QuietInstall(rest.to_string());
    }
    Mode::Install
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_program_name_quoted_or_not() {
        assert_eq!(after_program(r#""C:\Users\A B\Downloads\Rig-Setup.exe" /S"#), "/S");
        assert_eq!(after_program(r"C:\Rig\rig-setup.exe --uninstall"), "--uninstall");
        assert_eq!(after_program(r#""C:\Rig\rig-setup.exe""#), "");
    }

    #[test]
    fn double_click_opens_the_window() {
        assert_eq!(parse(""), Mode::Install);
    }

    #[test]
    fn nsis_flags_pass_through_untouched() {
        assert_eq!(parse("/S"), Mode::QuietInstall("/S".into()));
        assert_eq!(parse("/P /UPDATE /ARGS --x"), Mode::QuietInstall("/P /UPDATE /ARGS --x".into()));
    }

    #[test]
    fn settings_apps_uninstall_opens_the_uninstall_window() {
        assert_eq!(parse("--uninstall"), Mode::Uninstall { dir: None, from_temp: false });
        assert_eq!(
            parse(r#"--uninstall --dir "C:\Users\A B\AppData\Local\Rig" --from-temp"#),
            Mode::Uninstall { dir: Some(PathBuf::from(r"C:\Users\A B\AppData\Local\Rig")), from_temp: true }
        );
    }

    #[test]
    fn the_reinstall_pages_uninstall_keeps_spaces_in_the_folder() {
        // Tauri's installer runs UninstallString + " /P _?=<folder>".
        assert_eq!(
            parse(r"--uninstall /P _?=C:\Users\A B\AppData\Local\Rig"),
            Mode::QuietUninstall(r"/P _?=C:\Users\A B\AppData\Local\Rig".into())
        );
        assert_eq!(parse(r"--uninstall _?=C:\Rig"), Mode::QuietUninstall(r"_?=C:\Rig".into()));
    }

    #[test]
    fn preview_names_a_sample() {
        assert_eq!(parse("--preview update"), Mode::Preview("update".into()));
        assert_eq!(parse("--preview"), Mode::Preview("welcome".into()));
    }
}
