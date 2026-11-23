//! The bits of Windows setup needs: the registry, running programs, the
//! desktop folder, the window's corners, and leaving no files behind.

use std::ffi::{c_void, OsString};
use std::os::windows::ffi::OsStringExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Environment::GetCommandLineW;
use windows_sys::Win32::System::Registry::{RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
use windows_sys::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath};

/// Where Tauri's installer records Rig for Settings, Apps (it installs for the current user).
pub const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Rig";
/// The background recorder's service (helper/RigHelper/RecorderSetup.cs).
const RECORDER_KEY: &str = r"SYSTEM\CurrentControlSet\Services\RigRecorder";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn from_wide(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

pub fn command_line() -> String {
    unsafe {
        let p = GetCommandLineW();
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }
}

fn reg_string(root: HKEY, key: &str, value: &str) -> Option<String> {
    let (k, v) = (wide(key), wide(value));
    let mut buf = vec![0u16; 1024];
    let mut bytes = (buf.len() * 2) as u32;
    let r = unsafe { RegGetValueW(root, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr() as *mut c_void, &mut bytes) };
    (r == ERROR_SUCCESS).then(|| from_wide(&buf)).filter(|s| !s.is_empty())
}

fn reg_key_exists(root: HKEY, key: &str) -> bool {
    let k = wide(key);
    let mut h: HKEY = std::ptr::null_mut();
    let r = unsafe { RegOpenKeyExW(root, k.as_ptr(), 0, KEY_READ, &mut h) };
    if r == ERROR_SUCCESS {
        unsafe { RegCloseKey(h) };
        true
    } else {
        false
    }
}

#[derive(Debug, Clone)]
pub struct Installed {
    pub version: String,
    pub dir: PathBuf,
}

/// The Rig already on this PC, if any.
pub fn installed() -> Option<Installed> {
    let version = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "DisplayVersion")?;
    let dir = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "InstallLocation")
        .map(|d| PathBuf::from(d.trim_matches('"')))
        .unwrap_or_else(default_dir);
    Some(Installed { version, dir })
}

/// Where Tauri's installer puts Rig for the current user.
pub fn default_dir() -> PathBuf {
    local_app_data().join("Rig")
}

pub fn local_app_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

pub fn app_data() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

pub fn recorder_installed() -> bool {
    reg_key_exists(HKEY_LOCAL_MACHINE, RECORDER_KEY)
}

/// The names of running programs, in lower case ("rig.exe", "consent.exe").
pub fn running() -> Vec<String> {
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                out.push(from_wide(&e.szExeFile).to_lowercase());
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

pub fn rig_is_open() -> bool {
    running().iter().any(|n| n == "rig.exe")
}

/// The signed-in person's desktop folder, wherever it's been moved to (OneDrive included).
pub fn desktop() -> Option<PathBuf> {
    unsafe {
        let mut p: *mut u16 = std::ptr::null_mut();
        if SHGetKnownFolderPath(&FOLDERID_Desktop, 0, std::ptr::null_mut(), &mut p) != 0 || p.is_null() {
            return None;
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        let path = PathBuf::from(OsString::from_wide(std::slice::from_raw_parts(p, n)));
        CoTaskMemFree(p as *const c_void);
        Some(path)
    }
}

/// Rounded corners on Windows 11, like its own windows. Earlier Windows ignores it.
pub fn round_corners(hwnd: isize) {
    let pref = DWMWCP_ROUND;
    unsafe {
        DwmSetWindowAttribute(hwnd as _, DWMWA_WINDOW_CORNER_PREFERENCE as u32, &pref as *const _ as *const c_void, std::mem::size_of_val(&pref) as u32);
    }
}

/// Bytes in a folder and everything under it.
pub fn folder_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => folder_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Deletes `dir` a few seconds after setup exits, from a hidden command prompt,
/// because setup's own files (and the window's browser data) are in use until then.
pub fn delete_after_exit(dir: &Path) {
    let mut line = OsString::from("/d /c ping -n 5 127.0.0.1 >nul & rmdir /s /q \"");
    line.push(dir.as_os_str());
    line.push("\"");
    let _ = Command::new("cmd.exe").raw_arg(&line).creation_flags(CREATE_NO_WINDOW).spawn();
}
