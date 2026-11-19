//! Talks to RigHelper, the small C# program that reads sensors with
//! LibreHardwareMonitor and makes the catalog's settings changes. It needs
//! admin rights, so the app starts it once through the Windows "Yes / No"
//! prompt and talks to it over a private named pipe.
//!
//! Protocol: one JSON object per line.
//!   app → helper  {"id": 1, "method": "snapshot", "params": null}
//!   helper → app  {"id": 1, "result": {...}}  or  {"id": 1, "error": {"message": "..."}}
//!
//! Keeping it private: the app creates the pipe under a random name, allows
//! one connection only, and checks that the process that connected is the
//! helper it started. The helper checks that the pipe belongs to its parent,
//! accepts only calls from the fix catalog, and quits when the app does.

use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::sync::Mutex;

/// How long one call may take. Changing a display mode is the slowest.
#[cfg_attr(not(windows), allow(dead_code))]
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

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
}

/// Timed-out calls in a row before the helper counts as stuck and is started again.
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_TIMEOUTS: u32 = 3;

#[cfg_attr(not(windows), allow(dead_code))]
impl<S: AsyncRead + AsyncWrite> Conn<S> {
    pub fn new(stream: S) -> Self {
        let (r, w) = tokio::io::split(stream);
        Self { reader: BufReader::new(r), writer: w, next_id: 1, timeouts: 0 }
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
        let msg = match tokio::time::timeout(CALL_TIMEOUT, io).await {
            Err(_) => {
                self.timeouts += 1;
                let msg = "Rig's helper didn't answer in time.".to_string();
                return Err(if self.timeouts >= MAX_TIMEOUTS { CallError::Broken(msg) } else { CallError::Remote(msg) });
            }
            Ok(Err(e)) => return Err(CallError::Broken(e.to_string())),
            Ok(Ok(m)) => m,
        };
        self.timeouts = 0;
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
    #[cfg(windows)]
    conn: Mutex<Option<Conn<tokio::net::windows::named_pipe::NamedPipeServer>>>,
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
        let mut guard = self.conn.lock().await;
        if guard.is_none() {
            *guard = Some(Conn::new(win::launch().await?));
        }
        match guard.as_mut().unwrap().call(method, params).await {
            Ok(v) => Ok(v),
            Err(CallError::Remote(m)) => Err(m),
            Err(CallError::Broken(m)) => {
                *guard = None;
                Err(m)
            }
        }
    }
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
    use windows_sys::Win32::System::Threading::GetProcessId;
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
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

    pub async fn launch() -> Result<NamedPipeServer, String> {
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
        let args = format!("--pipe {name} --parent {parent}");

        let pid = match run_elevated(&exe, &args) {
            Some(pid) => pid,
            // Said No to the prompt: run without admin rights. Some sensors will be missing,
            // and Rig shows a card explaining how to turn them on.
            None => std::process::Command::new(&exe)
                .args(["--pipe", &name, "--parent", &parent, "--limited"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Rig couldn't start its helper. {e}"))?
                .id(),
        };

        tokio::time::timeout(Duration::from_secs(30), server.connect())
            .await
            .map_err(|_| "Rig's helper didn't start in time.".to_string())?
            .map_err(|e| e.to_string())?;

        let mut client: u32 = 0;
        let ok = unsafe { GetNamedPipeClientProcessId(server.as_raw_handle() as HANDLE, &mut client) };
        if ok == 0 || client != pid {
            return Err("Something other than Rig's helper connected, so Rig closed the channel.".into());
        }
        Ok(server)
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

    #[tokio::test]
    async fn a_stopped_helper_breaks_the_connection() {
        let (a, b) = duplex(64);
        drop(b);
        let mut c = Conn::new(a);
        assert!(matches!(c.call("hello", Value::Null).await, Err(CallError::Broken(_))));
    }
}
