//! Talks to RigHelper, the small C# program that reads sensors with
//! LibreHardwareMonitor and makes the catalog's settings changes. It needs
//! admin rights. The installer's one Windows prompt sets up a Task Scheduler
//! task that starts it with them (helper/RigHelper/HelperTask.cs), so opening
//! Rig doesn't ask again. Without that task (the prompt was refused, or the
//! task's copy is from another version) the app starts it through the Windows
//! "Yes / No" prompt as before. Either way it talks to it over a private named pipe.
//!
//! Protocol: one JSON object per line.
//!   app → helper  {"id": 1, "method": "snapshot", "params": null}
//!   helper → app  {"id": 1, "result": {...}}  or  {"id": 1, "error": {"message": "..."}}
//!
//! Keeping it private: the app creates the pipe under a random name, allows
//! one connection only, and checks that the process that connected is the
//! helper it started, or the task's copy in Program Files, where only admins
//! can write. The helper checks that the pipe belongs to the app, accepts
//! only calls from the fix catalog, and quits when the app does.

use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::sync::Mutex;

/// How long one call may take. Changing a display mode is the slowest.
#[cfg_attr(not(windows), allow(dead_code))]
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// A general command parses, reads, snapshots, runs and verifies in one call, each a PowerShell start, so it gets longer:
/// the helper's own limits (Commands.cs) for the parse, the run, the restore point and the reads before and after,
/// with room for the snapshot and the never-list readings around the run.
#[cfg_attr(not(windows), allow(dead_code))]
const COMMAND_PARSE_SECS: u64 = 30;
#[cfg_attr(not(windows), allow(dead_code))]
const COMMAND_RUN_SECS: u64 = 120;
#[cfg_attr(not(windows), allow(dead_code))]
const COMMAND_RESTORE_POINT_SECS: u64 = 15;
#[cfg_attr(not(windows), allow(dead_code))]
const COMMAND_READ_SECS: u64 = 20;
#[cfg_attr(not(windows), allow(dead_code))]
const COMMAND_TIMEOUT: Duration = Duration::from_secs(COMMAND_PARSE_SECS + COMMAND_RUN_SECS + COMMAND_RESTORE_POINT_SECS + 3 * COMMAND_READ_SECS + 90);

/// An apply or undo can run a program whose rules row gives it longer: winget's is 30 minutes (commands.json).
/// An apply that rolls back runs the undo too, and a winget read gets the run's 120 seconds.
#[cfg_attr(not(windows), allow(dead_code))]
const LONGEST_RUN_SECS: u64 = 30 * 60;
#[cfg_attr(not(windows), allow(dead_code))]
const APPLY_TIMEOUT: Duration = Duration::from_secs(COMMAND_PARSE_SECS + 2 * LONGEST_RUN_SECS + COMMAND_RESTORE_POINT_SECS + 3 * COMMAND_RUN_SECS + 90);

/// How long the helper may take to answer `method`. A step is a command by another name, and a look walks an app's window like one.
#[cfg_attr(not(windows), allow(dead_code))]
fn limit(method: &str) -> Duration {
    match method {
        "step.apply" | "command.apply" | "step.undo" | "command.undo" => APPLY_TIMEOUT,
        m if m.starts_with("command.") || m.starts_with("step.") || m.starts_with("screen.") => COMMAND_TIMEOUT,
        _ => CALL_TIMEOUT,
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub enum CallError {
    /// The helper answered with an error. The connection is still fine.
    Remote(String),
    /// The pipe broke or timed out. The helper will be started again on the next call.
    Broken(String),
}

#[cfg_attr(not(windows), allow(dead_code))]
pub struct Conn<S> {
    reader: BufReader<ReadHalf<S>>,
    writer: WriteHalf<S>,
    next_id: u64,
    /// Calls in a row that ran out of time. The helper is still working on them, so the
    /// connection stays until this many: starting it again means another Windows prompt.
    timeouts: u32,
    /// Whether the helper has answered a call yet. One that stops before its first answer refused the app.
    pub answered: bool,
}

/// Timed-out calls in a row before the helper counts as stuck and is started again.
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_TIMEOUTS: u32 = 3;

#[cfg_attr(not(windows), allow(dead_code))]
impl<S: AsyncRead + AsyncWrite> Conn<S> {
    pub fn new(stream: S) -> Self {
        let (r, w) = tokio::io::split(stream);
        Self { reader: BufReader::new(r), writer: w, next_id: 1, timeouts: 0, answered: false }
    }

    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, CallError> {
        let id = self.next_id;
        self.next_id += 1;
        let mut line = json!({ "id": id, "method": method, "params": params }).to_string();
        line.push('\n');
        let io = async {
            self.writer.write_all(line.as_bytes()).await?;
            self.writer.flush().await?;
            loop {
                let mut buf = String::new();
                if self.reader.read_line(&mut buf).await? == 0 {
                    return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "Rig's helper stopped."));
                }
                let msg: Value = serde_json::from_str(&buf).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                // Skip anything that isn't the answer to this call (a late answer to one that timed out).
                if msg.get("id").and_then(Value::as_u64) == Some(id) {
                    return Ok(msg);
                }
            }
        };
        let msg = match tokio::time::timeout(limit(method), io).await {
            Err(_) => {
                self.timeouts += 1;
                let msg = "Rig's helper didn't answer in time.".to_string();
                return Err(if self.timeouts >= MAX_TIMEOUTS { CallError::Broken(msg) } else { CallError::Remote(msg) });
            }
            Ok(Err(e)) => return Err(CallError::Broken(e.to_string())),
            Ok(Ok(m)) => m,
        };
        self.timeouts = 0;
        self.answered = true;
        if let Some(err) = msg.get("error") {
            let text = err.get("message").and_then(Value::as_str).unwrap_or("Rig's helper couldn't do that.");
            return Err(CallError::Remote(text.to_string()));
        }
        Ok(msg.get("result").cloned().unwrap_or(Value::Null))
    }
}

/// The helper connection, started on first use and restarted if it breaks.
#[derive(Default)]
pub struct Helper {
    /// The connection, and whether the helper on it was started by the installer's task.
    #[cfg(windows)]
    conn: Mutex<Option<(Conn<tokio::net::windows::named_pipe::NamedPipeServer>, bool)>>,
    /// Set when a helper the task started stopped before it answered (it wouldn't serve this Rig.exe): from then on,
    /// until Rig closes, the helper starts through Windows' prompt, so Rig doesn't start the task over and over.
    #[cfg(windows)]
    skip_task: std::sync::atomic::AtomicBool,
    #[cfg(not(windows))]
    _conn: Mutex<()>,
}

impl Helper {
    #[cfg(not(windows))]
    pub async fn call(&self, _method: &str, _params: Value) -> Result<Value, String> {
        // The TypeScript side looks for "unsupported" and uses a pretend PC instead.
        Err("unsupported: Rig reads sensors through its Windows helper, so this platform uses a simulated PC.".into())
    }

    #[cfg(windows)]
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let queued = std::time::Instant::now();
        let mut guard = self.conn.lock().await;
        let waited = queued.elapsed();
        if guard.is_none() {
            let t = std::time::Instant::now();
            log::info!("helper: starting it");
            let use_task = !self.skip_task.load(std::sync::atomic::Ordering::Relaxed);
            match win::launch(use_task).await {
                Ok((pipe, from_task)) => {
                    log::info!("helper: connected in {} ms", t.elapsed().as_millis());
                    *guard = Some((Conn::new(pipe), from_task));
                }
                Err(e) => {
                    log::error!("helper: couldn't start after {} ms: {e}", t.elapsed().as_millis());
                    return Err(e);
                }
            }
        }
        let t = std::time::Instant::now();
        let (conn, from_task) = guard.as_mut().unwrap();
        let result = conn.call(method, params).await;
        log_call(method, waited, t.elapsed(), &result);
        match result {
            Ok(v) => Ok(v),
            Err(CallError::Remote(m)) => Err(m),
            Err(CallError::Broken(m)) => {
                if give_up_on_task(*from_task, conn.answered) {
                    log::warn!("helper: the task's helper stopped before answering, so Windows asks from now on");
                    self.skip_task.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                log::warn!("helper: connection dropped, it starts again on the next call");
                *guard = None;
                Err(m)
            }
        }
    }
}

/// One line per helper call. Calls run every few seconds, so only slow or failed ones reach the log file;
/// the rest are debug lines, which it leaves out.
#[cfg_attr(not(windows), allow(dead_code))]
fn log_call(method: &str, waited: Duration, took: Duration, result: &Result<Value, CallError>) {
    let (w, t) = (waited.as_millis(), took.as_millis());
    let level = call_level(method, waited, took, result);
    match result {
        Ok(_) => log::log!(level, "helper: {method} took {t} ms (waited {w} ms for the previous call)"),
        Err(CallError::Remote(m)) => log::log!(level, "helper: {method} failed after {t} ms (waited {w} ms): {m}"),
        Err(CallError::Broken(m)) => log::log!(level, "helper: {method} broke after {t} ms (waited {w} ms): {m}"),
    }
}

/// How loud a call's line is: sensor reads over a second, other calls over two seconds, and failures are worth reading.
#[cfg_attr(not(windows), allow(dead_code))]
fn call_level(method: &str, waited: Duration, took: Duration, result: &Result<Value, CallError>) -> log::Level {
    let slow = Duration::from_millis(if method == "snapshot" { 1000 } else { 2000 });
    match result {
        Ok(_) if took < slow && waited < slow => log::Level::Debug,
        Ok(_) => log::Level::Info,
        Err(CallError::Remote(_)) => log::Level::Warn,
        Err(CallError::Broken(_)) => log::Level::Error,
    }
}

/// What `RigHelper.exe --start-task` answers (HelperTask.cs): 0 when Task Scheduler started the helper.
/// Anything else (no task, a copy from another version, a bad request) means asking Windows instead.
#[cfg_attr(not(windows), allow(dead_code))]
const TASK_STARTED: i32 = 0;

/// How long the helper the task started may take to connect before the app asks Windows instead.
#[cfg_attr(not(windows), allow(dead_code))]
const TASK_CONNECT: Duration = Duration::from_secs(15);

/// A helper the task started that stops before its first answer refused this Rig.exe (it serves only the one the
/// installer named), so starting the task again would only fail again.
#[cfg_attr(not(windows), allow(dead_code))]
fn give_up_on_task(from_task: bool, answered: bool) -> bool {
    from_task && !answered
}

/// Whether the process that connected to the pipe is Rig's helper: the one the app started itself, or the task's copy
/// (only admins can put a program there).
#[cfg_attr(not(windows), allow(dead_code))]
fn is_our_helper(client: u32, started: Option<u32>, client_image: Option<&str>, task_exe: Option<&str>) -> bool {
    if started == Some(client) {
        return true;
    }
    matches!((client_image, task_exe), (Some(image), Some(exe)) if same_path(image, exe))
}

/// Windows paths, compared as Windows does: case doesn't matter, nor which slash.
#[cfg_attr(not(windows), allow(dead_code))]
fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    !a.is_empty() && norm(a) == norm(b)
}

#[cfg(windows)]
pub use win::run_elevated_wait;

#[cfg(windows)]
mod win {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::time::Duration;
    use tokio::net::windows::named_pipe::{NamedPipeServer, PipeMode, ServerOptions};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::System::Threading::{
        GetProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::{
        FOLDERID_ProgramFiles, SHGetKnownFolderPath, ShellExecuteExW, KF_FLAG_DEFAULT, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Starts the helper with admin rights through the Windows prompt. Returns its process id,
    /// or None when the person chose No (or the prompt couldn't be shown).
    fn run_elevated(exe: &str, args: &str) -> Option<u32> {
        let verb = wide("runas");
        let file = wide(exe);
        let params = wide(args);
        unsafe {
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_NOCLOSEPROCESS;
            info.lpVerb = verb.as_ptr();
            info.lpFile = file.as_ptr();
            info.lpParameters = params.as_ptr();
            info.nShow = SW_HIDE;
            if ShellExecuteExW(&mut info) == 0 || info.hProcess.is_null() {
                return None;
            }
            let pid = GetProcessId(info.hProcess);
            CloseHandle(info.hProcess);
            Some(pid)
        }
    }

    /// Runs a program with admin rights through the Windows prompt and waits for it to finish.
    /// Returns its exit code, or None when the person chose No (or the prompt couldn't be shown).
    pub fn run_elevated_wait(exe: &str, args: &str, timeout: Duration) -> Option<u32> {
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
        let verb = wide("runas");
        let file = wide(exe);
        let params = wide(args);
        unsafe {
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_NOCLOSEPROCESS;
            info.lpVerb = verb.as_ptr();
            info.lpFile = file.as_ptr();
            info.lpParameters = params.as_ptr();
            info.nShow = SW_HIDE;
            if ShellExecuteExW(&mut info) == 0 || info.hProcess.is_null() {
                return None;
            }
            WaitForSingleObject(info.hProcess, timeout.as_millis().min(u32::MAX as u128) as u32);
            let mut code: u32 = 0;
            let got = GetExitCodeProcess(info.hProcess, &mut code);
            CloseHandle(info.hProcess);
            // Still running after the wait (259 is STILL_ACTIVE): report it as a failure rather than hang.
            Some(if got == 0 || code == 259 { 1 } else { code })
        }
    }

    /// The task's copy of the helper: %ProgramFiles%\Rig\Helper\RigHelper.exe (HelperTask.cs).
    fn task_exe() -> Option<String> {
        unsafe {
            let mut path: *mut u16 = std::ptr::null_mut();
            let hr = SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT as _, std::ptr::null_mut(), &mut path);
            if hr != 0 || path.is_null() {
                if !path.is_null() {
                    CoTaskMemFree(path as _);
                }
                return None;
            }
            let len = (0..).take_while(|&i| *path.add(i) != 0).count();
            let dir = String::from_utf16_lossy(std::slice::from_raw_parts(path, len));
            CoTaskMemFree(path as _);
            Some(format!(r"{dir}\Rig\Helper\RigHelper.exe"))
        }
    }

    /// The program a process runs, as a full path, or None when Windows won't say.
    fn image_of(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut buf = vec![0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size);
            CloseHandle(process);
            (ok != 0).then(|| String::from_utf16_lossy(&buf[..size as usize]))
        }
    }

    /// Asks Task Scheduler, through the helper in Rig's folder (no admin rights, no window), to start the helper with
    /// admin rights and no prompt. True when the task started; the helper then connects to the pipe by itself.
    async fn start_task(exe: &str, pipe: &str, parent: &str) -> bool {
        let (exe, pipe, parent) = (exe.to_string(), pipe.to_string(), parent.to_string());
        let ran = tokio::task::spawn_blocking(move || {
            let mut child = std::process::Command::new(&exe)
                .args(["--start-task", "--pipe", &pipe, "--parent", &parent])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .ok()?;
            let until = std::time::Instant::now() + Duration::from_secs(15);
            loop {
                if let Ok(Some(status)) = child.try_wait() {
                    return status.code();
                }
                if std::time::Instant::now() > until {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        })
        .await
        .ok()
        .flatten();
        match ran {
            Some(super::TASK_STARTED) => true,
            Some(code) => {
                log::info!("helper: no task to start it without a prompt (answer {code}), so Windows asks");
                false
            }
            None => {
                log::warn!("helper: the task didn't answer, so Windows asks");
                false
            }
        }
    }

    /// Starts the helper through Windows' prompt, or without admin rights when the person says No. Returns its process id.
    fn start_prompted(exe: &str, name: &str, parent: &str) -> Result<u32, String> {
        let args = format!("--pipe {name} --parent {parent}");
        match run_elevated(exe, &args) {
            Some(pid) => {
                log::info!("helper: running with admin rights (process {pid})");
                Ok(pid)
            }
            // Said No to the prompt: run without admin rights. Some sensors will be missing,
            // and Rig shows a card explaining how to turn them on.
            None => {
                log::warn!("helper: no admin rights (No at the prompt, or it couldn't show), so it runs limited");
                Ok(std::process::Command::new(exe)
                    .args(["--pipe", name, "--parent", parent, "--limited"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| format!("Rig couldn't start its helper. {e}"))?
                    .id())
            }
        }
    }

    /// Starts the helper and waits for it on a fresh pipe. Answers the pipe and whether the task started the helper.
    pub async fn launch(use_task: bool) -> Result<(NamedPipeServer, bool), String> {
        let token: String = (0..32).map(|_| format!("{:x}", rand::random::<u8>() & 0xf)).collect();
        let name = format!(r"\\.\pipe\rig-helper-{token}");
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .max_instances(1)
            .reject_remote_clients(true)
            .pipe_mode(PipeMode::Byte)
            .create(&name)
            .map_err(|e| format!("Rig couldn't open a channel to its helper. {e}"))?;

        // Packaged next to Rig.exe by the installer (Tauri's externalBin).
        let exe = std::env::current_exe().map_err(|e| e.to_string())?.with_file_name("RigHelper.exe");
        if !exe.exists() {
            return Err(format!("Rig's helper is missing ({}). Reinstall Rig.", exe.display()));
        }
        let exe = exe.to_string_lossy().to_string();
        let parent = std::process::id().to_string();
        let task_exe = task_exe();

        // The installer's task first: admin rights with no prompt. Then Windows' prompt, as before.
        let mut started = None;
        let mut from_task = use_task && task_exe.is_some() && start_task(&exe, &name, &parent).await;
        if from_task {
            log::info!("helper: started by Rig's task, with no prompt");
        } else {
            started = Some(start_prompted(&exe, &name, &parent)?);
        }

        let wait = if from_task { super::TASK_CONNECT } else { Duration::from_secs(30) };
        match tokio::time::timeout(wait, server.connect()).await {
            Ok(r) => r.map_err(|e| e.to_string())?,
            Err(_) if from_task => {
                log::warn!("helper: the task's helper didn't connect in {} s, so Windows asks", wait.as_secs());
                from_task = false;
                started = Some(start_prompted(&exe, &name, &parent)?);
                tokio::time::timeout(Duration::from_secs(30), server.connect())
                    .await
                    .map_err(|_| "Rig's helper didn't start in time.".to_string())?
                    .map_err(|e| e.to_string())?;
            }
            Err(_) => return Err("Rig's helper didn't start in time.".to_string()),
        }

        let mut client: u32 = 0;
        let ok = unsafe { GetNamedPipeClientProcessId(server.as_raw_handle() as HANDLE, &mut client) };
        let image = if ok != 0 && started != Some(client) { image_of(client) } else { None };
        if ok == 0 || !super::is_our_helper(client, started, image.as_deref(), task_exe.as_deref()) {
            return Err("Something other than Rig's helper connected, so Rig closed the channel.".into());
        }
        // Late to connect, the task's helper may still be the one that did.
        Ok((server, from_task || started != Some(client)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader};

    /// A pretend helper on the other end of an in-memory pipe.
    async fn fake_helper(stream: tokio::io::DuplexStream) {
        let (r, mut w) = tokio::io::split(stream);
        let mut lines = BufReader::new(r).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let req: Value = serde_json::from_str(&line).unwrap();
            let id = req["id"].clone();
            let reply = match req["method"].as_str() {
                Some("hello") => json!({ "id": id, "result": { "version": "test", "elevated": true } }),
                Some("slow") => {
                    tokio::time::sleep(CALL_TIMEOUT + Duration::from_secs(5)).await;
                    json!({ "id": id, "result": "late" })
                }
                Some("stale") => {
                    // Answers an old id first, then the real one.
                    w.write_all(format!("{}\n", json!({ "id": 999, "result": "old" })).as_bytes()).await.unwrap();
                    json!({ "id": id, "result": "fresh" })
                }
                _ => json!({ "id": id, "error": { "message": "That isn't in Rig's fix list." } }),
            };
            w.write_all(format!("{reply}\n").as_bytes()).await.unwrap();
        }
    }

    #[tokio::test]
    async fn calls_and_errors() {
        let (a, b) = duplex(4096);
        tokio::spawn(fake_helper(b));
        let mut c = Conn::new(a);
        let hello = c.call("hello", Value::Null).await.ok().unwrap();
        assert_eq!(hello["elevated"], true);
        assert_eq!(c.call("stale", Value::Null).await.ok().unwrap(), "fresh");
        match c.call("format_disk", Value::Null).await {
            Err(CallError::Remote(m)) => assert!(m.contains("fix list")),
            _ => panic!("expected a refusal"),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_answer_keeps_the_helper_until_it_looks_stuck() {
        let (a, b) = duplex(4096);
        tokio::spawn(fake_helper(b));
        let mut c = Conn::new(a);
        assert!(matches!(c.call("slow", Value::Null).await, Err(CallError::Remote(_))));
        assert_eq!(c.call("hello", Value::Null).await.ok().unwrap()["elevated"], true);
        assert!(matches!(c.call("slow", Value::Null).await, Err(CallError::Remote(_))));
        assert!(matches!(c.call("slow", Value::Null).await, Err(CallError::Remote(_))));
        assert!(matches!(c.call("slow", Value::Null).await, Err(CallError::Broken(_))));
    }

    #[test]
    fn a_step_gets_a_command_limit_and_an_apply_gets_winget_time() {
        assert_eq!(limit("sensors.read"), CALL_TIMEOUT);
        assert_eq!(limit("step.preview"), COMMAND_TIMEOUT);
        assert_eq!(limit("command.read"), COMMAND_TIMEOUT);
        assert_eq!(limit("screen.look"), COMMAND_TIMEOUT);
        assert!(limit("step.apply") > Duration::from_secs(2 * 30 * 60));
        assert_eq!(limit("step.undo"), limit("command.apply"));
    }

    #[test]
    fn only_slow_or_failed_calls_reach_the_log_file() {
        let ms = Duration::from_millis;
        let ok: Result<Value, CallError> = Ok(Value::Null);
        assert_eq!(call_level("snapshot", ms(0), ms(300), &ok), log::Level::Debug);
        assert_eq!(call_level("snapshot", ms(0), ms(1500), &ok), log::Level::Info);
        assert_eq!(call_level("processes", ms(0), ms(1500), &ok), log::Level::Debug);
        assert_eq!(call_level("facts", ms(1200), ms(100), &ok), log::Level::Debug);
        assert_eq!(call_level("processes", ms(0), ms(2500), &ok), log::Level::Info);
        assert_eq!(call_level("events", ms(2500), ms(100), &ok), log::Level::Info);
        assert_eq!(call_level("apply", ms(0), ms(10), &Err(CallError::Remote("no".into()))), log::Level::Warn);
        assert_eq!(call_level("facts", ms(0), ms(10), &Err(CallError::Broken("gone".into()))), log::Level::Error);
    }

    #[test]
    fn only_the_helper_rig_started_or_the_tasks_copy_may_connect() {
        let task = Some(r"C:\Program Files\Rig\Helper\RigHelper.exe");
        // The one Rig started through the prompt.
        assert!(is_our_helper(42, Some(42), None, task));
        // The task's copy, however Windows spells the path.
        assert!(is_our_helper(7, None, Some(r"c:\program files\rig\helper\righelper.exe"), task));
        assert!(is_our_helper(7, Some(42), Some(r"C:/Program Files/Rig/Helper/RigHelper.exe"), task));
        // Anything else that found the pipe.
        assert!(!is_our_helper(7, Some(42), None, task));
        assert!(!is_our_helper(7, None, Some(r"C:\Users\a\AppData\Local\Rig\RigHelper.exe"), task));
        assert!(!is_our_helper(7, None, Some(r"C:\Program Files\Rig\Helper\RigHelper.exe.evil"), task));
        assert!(!is_our_helper(7, None, Some(r"C:\Temp\RigHelper.exe"), None));
        assert!(!is_our_helper(7, None, Some(""), Some("")));
    }

    #[tokio::test]
    async fn a_task_helper_that_stops_before_answering_hands_over_to_the_prompt() {
        // Refused: it connected, then quit before its first answer.
        let (a, b) = duplex(64);
        drop(b);
        let mut c = Conn::new(a);
        assert!(matches!(c.call("hello", Value::Null).await, Err(CallError::Broken(_))));
        assert!(give_up_on_task(true, c.answered));
        assert!(!give_up_on_task(false, c.answered));
        // One that answered and then stopped (it crashed, or Rig's updating) gets the task again.
        let (a, b) = duplex(4096);
        tokio::spawn(fake_helper(b));
        let mut c = Conn::new(a);
        c.call("hello", Value::Null).await.ok().unwrap();
        assert!(c.answered);
        assert!(!give_up_on_task(true, c.answered));
    }

    #[tokio::test]
    async fn a_stopped_helper_breaks_the_connection() {
        let (a, b) = duplex(64);
        drop(b);
        let mut c = Conn::new(a);
        assert!(matches!(c.call("hello", Value::Null).await, Err(CallError::Broken(_))));
    }
}
