//! Reads the background recorder's log. The recorder is RigHelper running as a
//! Windows service (helper/RigHelper/RecorderService.cs); it writes one JSON
//! object per line, one file per UTC day, to %ProgramData%\Rig\Recorder\logs,
//! and status.json next to that. This side only reads those files, and turns
//! the service on or off by running the helper with admin rights.
//!
//! Reading is by cursor (a file and a byte offset): the files only ever grow,
//! so after the first read the app asks only for what was added since.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// One read returns at most this many lines, so the app never waits long on a big log.
pub const MAX_RECORDS: usize = 20_000;
pub const MAX_BYTES: u64 = 16 << 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cursor {
    pub file: String,
    pub offset: u64,
}

#[derive(Debug, Serialize)]
pub struct Page {
    pub records: Vec<Value>,
    /// Where the next read carries on. None when there's no log yet.
    pub cursor: Option<Cursor>,
    /// True when it stopped early; read again with the cursor for the rest.
    pub more: bool,
}

/// %ProgramData%\Rig\Recorder, on Windows.
pub fn data_dir() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    std::env::var_os("ProgramData").map(|p| PathBuf::from(p).join("Rig").join("Recorder"))
}

fn is_log(name: &str) -> bool {
    let b = name.as_bytes();
    name.len() == 16
        && name.ends_with(".jsonl")
        && b[..10].iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// The day log files, oldest first, with their sizes.
fn logs(dir: &Path) -> Vec<(String, u64)> {
    let Ok(rd) = std::fs::read_dir(dir.join("logs")) else { return vec![] };
    let mut out: Vec<(String, u64)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            is_log(&name).then(|| (name, e.metadata().map(|m| m.len()).unwrap_or(0)))
        })
        .collect();
    out.sort();
    out
}

/// The file name for the UTC day of a time in milliseconds (civil-from-days, so no date crate is needed).
pub fn day_file(ms: i64) -> String {
    let z = ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}.jsonl")
}

/// Reads lines from `from` (the day it falls in, through today), or from where `cursor` stopped.
pub fn read(dir: &Path, from: i64, cursor: Option<Cursor>, max_records: usize, max_bytes: u64) -> Page {
    let files = logs(dir);
    let (start_file, mut offset) = match &cursor {
        Some(c) if files.iter().any(|(n, _)| *n == c.file) => (c.file.clone(), c.offset),
        // The cursor's file was pruned: carry on with the next one there is.
        Some(c) => (c.file.clone(), u64::MAX),
        None => (day_file(from), 0),
    };
    let mut page = Page { records: vec![], cursor: cursor.clone(), more: false };
    let mut budget = max_bytes;
    for (name, size) in files.iter().filter(|(n, _)| *n >= start_file) {
        if offset == u64::MAX || *name != start_file {
            offset = if *name == start_file { *size } else { 0 };
        }
        let at = offset.min(*size);
        page.cursor = Some(Cursor { file: name.clone(), offset: at });
        if at >= *size {
            continue;
        }
        let want = (*size - at).min(budget);
        let mut buf = Vec::with_capacity(want as usize);
        let ok = File::open(dir.join("logs").join(name))
            .and_then(|mut f| {
                f.seek(SeekFrom::Start(at))?;
                f.take(want).read_to_end(&mut buf)
            })
            .is_ok();
        if !ok {
            continue;
        }
        // Only whole lines: one still being written (or cut short by power loss) waits for the next read.
        let mut used = 0usize;
        while let Some(nl) = buf[used..].iter().position(|b| *b == b'\n') {
            let line = &buf[used..used + nl];
            used += nl + 1;
            if let Ok(v @ Value::Object(_)) = serde_json::from_slice::<Value>(line) {
                page.records.push(v);
            }
            if page.records.len() >= max_records {
                break;
            }
        }
        budget -= used as u64;
        page.cursor = Some(Cursor { file: name.clone(), offset: at + used as u64 });
        let rest_unread = at + (used as u64) < *size;
        if page.records.len() >= max_records || (rest_unread && (want < *size - at || budget == 0)) {
            page.more = true;
            break;
        }
    }
    page
}

/// What Settings shows: whether the service is there and running, when it last wrote, and how much the log takes.
pub fn status(dir: Option<&Path>, service: Option<&str>) -> Value {
    let Some(dir) = dir else { return json!({ "supported": false }) };
    let files = logs(dir);
    let raw: Value = std::fs::read_to_string(dir.join("status.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    json!({
        "supported": true,
        "service": service,
        "state": raw.get("state"),
        "version": raw.get("v"),
        "startedAt": raw.get("startedAt"),
        "lastT": raw.get("lastT"),
        "bytes": files.iter().map(|(_, s)| s).sum::<u64>(),
        "days": files.len(),
        "oldest": files.first().map(|(n, _)| n.trim_end_matches(".jsonl")),
    })
}

/// The service's state from Windows: "running", "stopped", "starting" or "stopping", or None when it isn't installed.
#[cfg(windows)]
pub fn service_state() -> Option<&'static str> {
    use windows_sys::Win32::System::Services::*;
    let name: Vec<u16> = "RigRecorder".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let scm = OpenSCManagerW(std::ptr::null(), std::ptr::null(), SC_MANAGER_CONNECT);
        if scm.is_null() {
            return None;
        }
        let svc = OpenServiceW(scm, name.as_ptr(), SERVICE_QUERY_STATUS);
        let state = if svc.is_null() {
            None
        } else {
            let mut st: SERVICE_STATUS = std::mem::zeroed();
            let s = if QueryServiceStatus(svc, &mut st) == 0 {
                Some("unknown")
            } else {
                Some(match st.dwCurrentState {
                    SERVICE_RUNNING => "running",
                    SERVICE_STOPPED => "stopped",
                    SERVICE_START_PENDING => "starting",
                    SERVICE_STOP_PENDING => "stopping",
                    _ => "unknown",
                })
            };
            CloseServiceHandle(svc);
            s
        };
        CloseServiceHandle(scm);
        state
    }
}

#[cfg(not(windows))]
pub fn service_state() -> Option<&'static str> {
    None
}

/// Turns the recorder on or off by running the helper with admin rights (the same commands the installer runs).
#[cfg(windows)]
pub fn set(on: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Can't tell where Rig is installed.")?;
    let helper = dir.join("RigHelper.exe");
    if !helper.exists() {
        return Err(format!("Rig's helper is missing ({}). Reinstall Rig.", helper.display()));
    }
    let args = if on { format!("--install-recorder --app-dir \"{}\"", dir.display()) } else { "--uninstall-recorder".to_string() };
    match crate::helper::run_elevated_wait(&helper.to_string_lossy(), &args, std::time::Duration::from_secs(120)) {
        None => Err("Windows didn't give permission, so nothing changed.".into()),
        Some(0) => Ok(()),
        Some(6) => Err("That needs admin rights. Choose Yes when Windows asks.".into()),
        Some(code) => Err(format!(
            "Rig couldn't {} its recorder (code {code}). Details are in {}.",
            if on { "set up" } else { "remove" },
            data_dir().map(|d| d.join("setup.log").display().to_string()).unwrap_or_default()
        )),
    }
}

#[cfg(not(windows))]
pub fn set(_on: bool) -> Result<(), String> {
    Err("unsupported: the background recorder is a Windows service.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("rig-recorder-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("logs")).unwrap();
        d
    }

    fn append(dir: &Path, file: &str, text: &str) {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("logs").join(file)).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    const NOV17: i64 = 1_794_916_800_000; // 2026-11-17T12:00:00Z

    #[test]
    fn names_days_in_utc() {
        assert_eq!(day_file(NOV17), "2026-11-17.jsonl");
        assert_eq!(day_file(0), "1970-01-01.jsonl");
        assert_eq!(day_file(951_782_400_000), "2000-02-29.jsonl");
        assert!(is_log("2026-11-17.jsonl"));
        assert!(!is_log("status.json") && !is_log("2026-11-17.jsonl.tmp") && !is_log("20261117xx.jsonl"));
    }

    #[test]
    fn reads_whole_lines_and_carries_on_from_the_cursor() {
        let d = temp("cursor");
        append(&d, "2026-11-16.jsonl", "{\"k\":\"s\",\"t\":1}\n");
        append(&d, "2026-11-17.jsonl", "{\"k\":\"start\",\"t\":2}\n\nnot json\n[1,2]\n{\"k\":\"s\",\"t\":3}\n{\"k\":\"s\",\"t\":");
        append(&d, "notes.txt", "ignored");

        // From Nov 17: the day before is left out, junk and half-written lines are skipped.
        let p = read(&d, NOV17, None, 100, MAX_BYTES);
        let ts: Vec<i64> = p.records.iter().map(|r| r["t"].as_i64().unwrap()).collect();
        assert_eq!(ts, vec![2, 3]);
        assert!(!p.more);
        let c = p.cursor.clone().unwrap();
        assert_eq!(c.file, "2026-11-17.jsonl");

        // Nothing new: nothing comes back and the cursor stays.
        let again = read(&d, NOV17, Some(c.clone()), 100, MAX_BYTES);
        assert!(again.records.is_empty());
        assert_eq!(again.cursor, Some(c.clone()));

        // The half line is finished, and the next day starts.
        append(&d, "2026-11-17.jsonl", "4}\n");
        append(&d, "2026-11-18.jsonl", "{\"k\":\"s\",\"t\":5}\n");
        let next = read(&d, NOV17, Some(c), 100, MAX_BYTES);
        let ts: Vec<i64> = next.records.iter().map(|r| r["t"].as_i64().unwrap()).collect();
        assert_eq!(ts, vec![4, 5]);
        assert_eq!(next.cursor.unwrap().file, "2026-11-18.jsonl");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn stops_early_and_says_there_is_more() {
        let d = temp("more");
        let lines: String = (0..10).map(|i| format!("{{\"k\":\"s\",\"t\":{i}}}\n")).collect();
        append(&d, "2026-11-17.jsonl", &lines);
        let first = read(&d, NOV17, None, 4, MAX_BYTES);
        assert_eq!(first.records.len(), 4);
        assert!(first.more);
        let mut all = first.records.len();
        let mut c = first.cursor;
        loop {
            let p = read(&d, NOV17, c, 4, MAX_BYTES);
            all += p.records.len();
            c = p.cursor;
            if !p.more {
                break;
            }
        }
        assert_eq!(all, 10);

        // A byte budget smaller than the file also stops on a whole line.
        let small = read(&d, NOV17, None, 100, 40);
        assert!(small.more);
        assert_eq!(small.records.len(), 2);
        assert_eq!(small.cursor.unwrap().offset, 32);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_pruned_cursor_file_moves_on_to_the_next_day() {
        let d = temp("pruned");
        append(&d, "2026-11-18.jsonl", "{\"k\":\"s\",\"t\":9}\n");
        let p = read(&d, NOV17, Some(Cursor { file: "2026-10-01.jsonl".into(), offset: 500 }), 100, MAX_BYTES);
        assert_eq!(p.records.len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn status_sums_the_log() {
        let d = temp("status");
        append(&d, "2026-11-17.jsonl", "{\"k\":\"s\",\"t\":1}\n");
        std::fs::write(d.join("status.json"), r#"{"state":"running","v":"0.1.1","lastT":5}"#).unwrap();
        let s = status(Some(&d), Some("running"));
        assert_eq!(s["state"], "running");
        assert_eq!(s["bytes"], 16);
        assert_eq!(s["oldest"], "2026-11-17");
        assert_eq!(status(None, None)["supported"], false);
        let _ = std::fs::remove_dir_all(&d);
    }
}
