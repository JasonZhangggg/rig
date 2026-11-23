//! Rig's desktop shell. The screens and all the logic live in TypeScript
//! (packages/core and packages/ui); this side only does what a web page can't:
//! start the elevated helper, keep data on disk, keep the sign-in token in
//! the keychain, start with Windows when the person turns that on, read
//! the background recorder's log, and install updates.

mod clipboard;
mod helper;
mod recorder;
mod secrets;
mod store;

use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;

type R<T> = Result<T, String>;

#[tauri::command]
async fn helper_call(helper: State<'_, helper::Helper>, method: String, params: Value) -> R<Value> {
    helper.call(&method, params).await
}

#[tauri::command]
fn kv_get(store: State<'_, store::Store>, key: String) -> R<Option<Value>> { store.get(&key) }

#[tauri::command]
fn kv_set(store: State<'_, store::Store>, key: String, value: Value) -> R<()> { store.set(&key, &value) }

#[tauri::command]
fn history_add(store: State<'_, store::Store>, point: Value) -> R<()> { store.add_history(&point) }

#[tauri::command]
fn history_since(store: State<'_, store::Store>, since: i64) -> R<Vec<Value>> { store.history_since(since) }

#[tauri::command]
fn changes_list(store: State<'_, store::Store>) -> R<Vec<Value>> { store.changes() }

#[tauri::command]
fn change_put(store: State<'_, store::Store>, change: Value) -> R<()> { store.put_change(&change) }

#[tauri::command]
fn token_get() -> R<Option<String>> { secrets::get() }

#[tauri::command]
fn token_set(token: Option<String>) -> R<()> { secrets::set(token.as_deref()) }

/// Whether the background recorder is installed and running, and how much its log takes.
#[tauri::command]
async fn recorder_status() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        recorder::status(recorder::data_dir().as_deref(), recorder::service_state(), recorder::current_sid().as_deref())
    })
        .await
        .unwrap_or(Value::Null)
}

/// The recorder's log from a time, or from where the last read stopped.
#[tauri::command]
async fn recorder_read(from: i64, cursor: Option<recorder::Cursor>) -> R<recorder::Page> {
    let Some(dir) = recorder::data_dir() else { return Err("unsupported: the background recorder is a Windows service.".into()) };
    tauri::async_runtime::spawn_blocking(move || recorder::read(&dir.join("logs"), from, cursor, recorder::MAX_RECORDS, recorder::MAX_BYTES))
        .await
        .map_err(|e| e.to_string())
}

/// This account's custom logs, read the same way. Empty when there are none.
#[tauri::command]
async fn recorder_read_custom(from: i64, cursor: Option<recorder::Cursor>) -> R<recorder::Page> {
    let Some(dir) = recorder::data_dir() else { return Err("unsupported: the background recorder is a Windows service.".into()) };
    tauri::async_runtime::spawn_blocking(move || match recorder::custom_dir(&dir, recorder::current_sid().as_deref()) {
        Some((_, folder)) => recorder::read(&folder, from, cursor, recorder::MAX_RECORDS, recorder::MAX_BYTES),
        None => recorder::Page { records: vec![], cursor, more: false },
    })
    .await
    .map_err(|e| e.to_string())
}

/// Approves a script the person chose Approve on. Windows asks for permission, every time.
#[tauri::command]
async fn recorder_approve_script(probe: Value, hash: String) -> R<Value> {
    tauri::async_runtime::spawn_blocking(move || recorder::approve_script(&probe, &hash)).await.map_err(|e| e.to_string())?
}

/// Turns the background recorder on or off. Windows asks for permission.
#[tauri::command]
async fn recorder_set(on: bool) -> R<()> {
    tauri::async_runtime::spawn_blocking(move || recorder::set(on)).await.map_err(|e| e.to_string())?
}

/// Opens the folder that holds Rig's log files.
#[tauri::command]
fn open_logs(app: tauri::AppHandle) -> R<()> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// The text on the clipboard, for Paste in Rig's own right-click menu
/// (src/contextmenu.ts). The page can't read the clipboard by itself.
#[tauri::command]
fn clipboard_text() -> Option<String> {
    clipboard::text()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Rig.log in %LOCALAPPDATA%\app.rig.desktop\logs (Settings > About opens it), plus the terminal under `pnpm desktop`.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir { file_name: Some("Rig".into()) }),
                    Target::new(TargetKind::Stdout),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Rig").build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Only installer builds carry the updater's key and address (the windows-installer
            // action adds them), so a copy run from the code never replaces itself with a release.
            #[cfg(desktop)]
            if app.config().plugins.0.contains_key("updater") {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            log::info!("Rig {} starting", app.package_info().version);
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(store::Store::open(&dir.join("rig.db"))?);
            app.manage(helper::Helper::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            helper_call, kv_get, kv_set, history_add, history_since, changes_list, change_put, token_get, token_set,
            recorder_status, recorder_read, recorder_set, recorder_read_custom, recorder_approve_script, open_logs, clipboard_text
        ])
        .run(tauri::generate_context!())
        .expect("Rig couldn't start");
}
