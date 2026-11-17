//! Rig's desktop shell. The screens and all the logic live in TypeScript
//! (packages/core and packages/ui); this side only does what a web page can't:
//! start the elevated helper, keep data on disk, keep the sign-in token in
//! the keychain and start with Windows when the person turns that on.

mod helper;
mod secrets;
mod store;

use serde_json::Value;
use tauri::{Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Rig").build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(store::Store::open(&dir.join("rig.db"))?);
            app.manage(helper::Helper::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            helper_call, kv_get, kv_set, history_add, history_since, changes_list, change_put, token_get, token_set
        ])
        .run(tauri::generate_context!())
        .expect("Rig couldn't start");
}
