//! The account sign-in token, kept in the OS keychain (Windows Credential
//! Manager) instead of a file.

use keyring::Entry;

const SERVICE: &str = "app.rig.desktop";
const USER: &str = "account";

fn entry() -> Result<Entry, String> { Entry::new(SERVICE, USER).map_err(|e| e.to_string()) }

pub fn get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set(token: Option<&str>) -> Result<(), String> {
    let e = entry()?;
    match token {
        Some(t) => e.set_password(t).map_err(|e| e.to_string()),
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    }
}
