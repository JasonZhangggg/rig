//! Reads the background recorder's log. The recorder is RigHelper running as a
//! Windows service (helper/RigHelper/RecorderService.cs); it writes one JSON
//! object per line, one file per UTC day, to %ProgramData%\Rig\Recorder\logs,
//! and status.json next to that. This side only reads those files, and turns
//! the service on or off by running the helper with admin rights.
//!
//! Custom logs (ones Rig's chat set up, or the person did) go to custom\<SID>, a folder only that Windows account
//! can read. The app reads its own folder the same way it reads the main log.
//!
//! Reading is by cursor (a file and a byte offset): the files only ever grow,
//! so after the first read the app asks only for what was added since.

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// One read returns at most this many lines, so the app never waits long on a big log, and never holds much of it at once.
/// The first read of a week takes several pages; the app thins each finished day as it goes.
pub const MAX_RECORDS: usize = 5_000;
pub const MAX_BYTES: u64 = 2 << 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cursor {
    pub file: String,
    pub offset: u64,
}

#[derive(Debug, Serialize)]
pub struct Page {
    /// Each line as it was written, checked to be a JSON object but not decoded: the app decodes it once, on its side.
    pub records: Vec<Box<RawValue>>,
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

/// The day log files in a logs folder, oldest first, with their sizes.
fn logs(folder: &Path) -> Vec<(String, u64)> {
    let Ok(rd) = std::fs::read_dir(folder) else { return vec![] };
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

/// Reads lines from a logs folder from `from` (the day it falls in, through today), or from where `cursor` stopped.
pub fn read(folder: &Path, from: i64, cursor: Option<Cursor>, max_records: usize, max_bytes: u64) -> Page {
    let files = logs(folder);
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
        let ok = File::open(folder.join(name))
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
            if let Some(v) = object_line(line) {
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

/// A line that holds one JSON object, kept as written.
fn object_line(line: &[u8]) -> Option<Box<RawValue>> {
    let text = std::str::from_utf8(line).ok()?.trim();
    if !text.starts_with('{') {
        return None;
    }
    RawValue::from_string(text.to_owned()).ok()
}

/// What Settings shows: whether the service is there and running, when it last wrote, and how much the log takes.
pub fn status(dir: Option<&Path>, service: Option<&str>, me: Option<&str>) -> Value {
    let Some(dir) = dir else { return json!({ "supported": false }) };
    let files = logs(&dir.join("logs"));
    let mine = custom_dir(dir, me).map(|(sid, _)| sid);
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
        "probes": probes_for(raw.get("probes"), mine.as_deref().or(me)),
        "mine": mine,
    })
}

/// The custom logs that belong to this account, from the service's status. Other accounts' logs stay out.
fn probes_for(probes: Option<&Value>, me: Option<&str>) -> Value {
    let Some(p) = probes.filter(|p| p.is_object()) else { return Value::Null };
    let list: Vec<Value> = p["list"]
        .as_array()
        .map(|l| l.iter().filter(|x| me.is_some() && x["owner"].as_str() == me).cloned().collect())
        .unwrap_or_default();
    let mut out = json!({ "list": list });
    if let Some(problems) = p.get("problems").filter(|x| x.is_array()) {
        out["problems"] = problems.clone();
    }
    out
}

fn is_sid(name: &str) -> bool {
    name.starts_with("S-1-") && name.len() <= 184 && name[4..].bytes().all(|c| c.is_ascii_digit() || c == b'-')
}

/// This account's custom log folder, and its name (the account's SID). With no SID to go by, the first folder
/// this account can read: the service lets each account read only its own.
pub fn custom_dir(dir: &Path, me: Option<&str>) -> Option<(String, PathBuf)> {
    let root = dir.join("custom");
    if let Some(me) = me.filter(|m| is_sid(m)) {
        let p = root.join(me);
        return p.is_dir().then(|| (me.to_string(), p));
    }
    let mut names: Vec<String> = std::fs::read_dir(&root)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| is_sid(n))
        .collect();
    names.sort();
    names.into_iter().map(|n| (n.clone(), root.join(&n))).find(|(_, p)| std::fs::read_dir(p).is_ok())
}

/// The SID of the Windows account Rig runs as.
#[cfg(windows)]
pub fn current_sid() -> Option<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        // u64s, so the TOKEN_USER read from it is aligned.
        let mut buf = vec![0u64; 64];
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), (buf.len() * 8) as u32, &mut len);
        CloseHandle(token);
        if ok == 0 {
            return None;
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text: *mut u16 = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 || text.is_null() {
            return None;
        }
        let n = (0..).take_while(|&i| *text.add(i) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, n));
        LocalFree(text.cast());
        Some(sid)
    }
}

#[cfg(not(windows))]
pub fn current_sid() -> Option<String> {
    None
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
        Some(8) if !on => Err("The background recorder is off, but a protection Rig had turned off for a while didn't come back on. Turn it on in Windows Security. Windows' event log (Application) says which.".into()),
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

/// The helper's answer (exit code 12) when User Account Control is turned down, for steps and scripts alike.
#[cfg(windows)]
const PROMPT_LOWERED: &str = "User Account Control is turned down on this PC, so Windows' prompt can't show it was you who said yes. Rig won't make changes that need admin rights until it's back to its usual setting.";

/// Approves a script behind Windows' own permission prompt: the helper reads the script from a file only this
/// account can write, checks it against the hash the app showed, and pins it. Returns the helper's answer.
#[cfg(windows)]
pub fn approve_script(probe: &Value, hash: &str) -> Result<Value, String> {
    if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Rig couldn't read the script's fingerprint.".into());
    }
    let owner = current_sid().ok_or("Rig couldn't tell which Windows account this is.")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let helper = exe.parent().ok_or("Can't tell where Rig is installed.")?.join("RigHelper.exe");
    if !helper.exists() {
        return Err(format!("Rig's helper is missing ({}). Reinstall Rig.", helper.display()));
    }
    let file = std::env::temp_dir().join(format!("rig-approve-{}-{}.json", std::process::id(), rand::random::<u32>()));
    let result = PathBuf::from(format!("{}.result", file.display()));
    std::fs::write(&file, json!({ "probe": probe, "owner": owner }).to_string()).map_err(|e| e.to_string())?;
    let args = format!("--approve-script \"{}\" --hash {hash}", file.display());
    let code = crate::helper::run_elevated_wait(&helper.to_string_lossy(), &args, std::time::Duration::from_secs(120));
    let answer: Option<Value> = std::fs::read_to_string(&result).ok().and_then(|s| serde_json::from_str(&s).ok());
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_file(&result);
    match (code, answer) {
        (None, _) => Err("Windows didn't give permission, so the script isn't approved.".into()),
        (Some(12), _) => Err(PROMPT_LOWERED.into()),
        (_, Some(a)) if a["ok"] == true => Ok(a["probes"].clone()),
        (_, Some(a)) => Err(a["error"].as_str().unwrap_or("Rig couldn't approve the script.").to_string()),
        (Some(6), None) => Err("That needs admin rights. Choose Yes when Windows asks.".into()),
        (Some(code), None) => Err(format!("Rig couldn't approve the script (code {code}).")),
    }
}

#[cfg(not(windows))]
pub fn approve_script(_probe: &Value, _hash: &str) -> Result<Value, String> {
    Err("unsupported: scripts run in the background recorder, which is a Windows service.".into())
}

/// Approves a step (a command or a native op) that needs admin rights behind Windows' own permission prompt. The helper
/// already holds the step under `nonce` from its preview; this only tells it which one, and `hash` is the step's
/// fingerprint as the app showed it. The helper marks the nonce approved only if the two match, and answers with its exit code.
#[cfg(windows)]
pub fn approve_command(nonce: &str, hash: &str) -> Result<(), String> {
    let hex = |s: &str, len: usize| s.len() == len && s.bytes().all(|c| c.is_ascii_hexdigit());
    if !hex(nonce, 32) || !hex(hash, 64) {
        return Err("Rig couldn't read which change to approve.".into());
    }
    let owner = current_sid().ok_or("Rig couldn't tell which Windows account this is.")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let helper = exe.parent().ok_or("Can't tell where Rig is installed.")?.join("RigHelper.exe");
    if !helper.exists() {
        return Err(format!("Rig's helper is missing ({}). Reinstall Rig.", helper.display()));
    }
    let file = std::env::temp_dir().join(format!("rig-approve-{}-{}.json", std::process::id(), rand::random::<u32>()));
    std::fs::write(&file, json!({ "nonce": nonce, "owner": owner }).to_string()).map_err(|e| e.to_string())?;
    let args = format!("--approve-step \"{}\" --hash {hash}", file.display());
    let code = crate::helper::run_elevated_wait(&helper.to_string_lossy(), &args, std::time::Duration::from_secs(120));
    let _ = std::fs::remove_file(&file);
    match code {
        None => Err("Windows didn't give permission, so the change isn't approved.".into()),
        Some(0) => Ok(()),
        Some(6) => Err("That needs admin rights. Choose Yes when Windows asks.".into()),
        Some(10) => Err("This change waited too long for approval. Look at it again in Rig.".into()),
        Some(11) => Err("The command changed after you chose Approve, so Rig didn't approve it.".into()),
        Some(12) => Err(PROMPT_LOWERED.into()),
        Some(code) => Err(format!("Rig couldn't approve the change (code {code}).")),
    }
}

#[cfg(not(windows))]
pub fn approve_command(_nonce: &str, _hash: &str) -> Result<(), String> {
    Err("unsupported: commands run through Rig's Windows helper.".into())
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

    fn t_of(line: &str) -> i64 {
        serde_json::from_str::<Value>(line).unwrap()["t"].as_i64().unwrap()
    }

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
        let p = read(&d.join("logs"), NOV17, None, 100, MAX_BYTES);
        let ts: Vec<i64> = p.records.iter().map(|r| t_of(r.get())).collect();
        assert_eq!(ts, vec![2, 3]);
        // The lines go to the app as written: objects, not strings, and not decoded here.
        let sent = serde_json::to_string(&p).unwrap();
        assert!(sent.starts_with(r#"{"records":[{"k":"start","t":2},{"k":"s","t":3}],"#), "{sent}");
        assert!(!p.more);
        let c = p.cursor.clone().unwrap();
        assert_eq!(c.file, "2026-11-17.jsonl");

        // Nothing new: nothing comes back and the cursor stays.
        let again = read(&d.join("logs"), NOV17, Some(c.clone()), 100, MAX_BYTES);
        assert!(again.records.is_empty());
        assert_eq!(again.cursor, Some(c.clone()));

        // The half line is finished, and the next day starts.
        append(&d, "2026-11-17.jsonl", "4}\n");
        append(&d, "2026-11-18.jsonl", "{\"k\":\"s\",\"t\":5}\n");
        let next = read(&d.join("logs"), NOV17, Some(c), 100, MAX_BYTES);
        let ts: Vec<i64> = next.records.iter().map(|r| t_of(r.get())).collect();
        assert_eq!(ts, vec![4, 5]);
        assert_eq!(next.cursor.unwrap().file, "2026-11-18.jsonl");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn stops_early_and_says_there_is_more() {
        let d = temp("more");
        let lines: String = (0..10).map(|i| format!("{{\"k\":\"s\",\"t\":{i}}}\n")).collect();
        append(&d, "2026-11-17.jsonl", &lines);
        let first = read(&d.join("logs"), NOV17, None, 4, MAX_BYTES);
        assert_eq!(first.records.len(), 4);
        assert!(first.more);
        let mut all = first.records.len();
        let mut c = first.cursor;
        loop {
            let p = read(&d.join("logs"), NOV17, c, 4, MAX_BYTES);
            all += p.records.len();
            c = p.cursor;
            if !p.more {
                break;
            }
        }
        assert_eq!(all, 10);

        // A byte budget smaller than the file also stops on a whole line.
        let small = read(&d.join("logs"), NOV17, None, 100, 40);
        assert!(small.more);
        assert_eq!(small.records.len(), 2);
        assert_eq!(small.cursor.unwrap().offset, 32);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_pruned_cursor_file_moves_on_to_the_next_day() {
        let d = temp("pruned");
        append(&d, "2026-11-18.jsonl", "{\"k\":\"s\",\"t\":9}\n");
        let p = read(&d.join("logs"), NOV17, Some(Cursor { file: "2026-10-01.jsonl".into(), offset: 500 }), 100, MAX_BYTES);
        assert_eq!(p.records.len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn status_sums_the_log() {
        let d = temp("status");
        append(&d, "2026-11-17.jsonl", "{\"k\":\"s\",\"t\":1}\n");
        std::fs::write(d.join("status.json"), r#"{"state":"running","v":"0.1.1","lastT":5}"#).unwrap();
        let s = status(Some(&d), Some("running"), None);
        assert_eq!(s["state"], "running");
        assert_eq!(s["bytes"], 16);
        assert_eq!(s["oldest"], "2026-11-17");
        assert_eq!(status(None, None, None)["supported"], false);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn custom_logs_are_only_this_accounts() {
        let d = temp("custom");
        let me = "S-1-5-21-1-2-3-1001";
        std::fs::create_dir_all(d.join("custom").join(me)).unwrap();
        std::fs::create_dir_all(d.join("custom").join("not-a-sid")).unwrap();
        std::fs::write(d.join("custom").join(me).join("2026-11-17.jsonl"), "{\"k\":\"p\",\"t\":1,\"id\":\"a\",\"v\":3}\n").unwrap();
        std::fs::write(
            d.join("status.json"),
            r#"{"state":"running","probes":{"list":[{"id":"a","owner":"S-1-5-21-1-2-3-1001"},{"id":"b","owner":"S-1-5-21-9"}],"problems":["x"]}}"#,
        )
        .unwrap();
        let (name, folder) = custom_dir(&d, None).unwrap();
        assert_eq!(name, me);
        assert_eq!(custom_dir(&d, Some(me)).unwrap().0, me);
        assert!(custom_dir(&d, Some("S-1-5-21-9")).is_none());
        assert!(custom_dir(&d, Some("..\\x")).is_some_and(|(n, _)| n == me));
        let p = read(&folder, NOV17, None, 100, MAX_BYTES);
        assert_eq!(p.records.len(), 1);
        let s = status(Some(&d), Some("running"), None);
        assert_eq!(s["mine"], me);
        let ids: Vec<&str> = s["probes"]["list"].as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["a"]);
        assert_eq!(s["probes"]["problems"][0], "x");
        let _ = std::fs::remove_dir_all(&d);
    }
}
