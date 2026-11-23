// Rig's setup and uninstall window. See README.md.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#![cfg_attr(not(windows), allow(dead_code))]

mod args;
mod payload;
mod progress;
mod version;
#[cfg(windows)]
mod app;
#[cfg(windows)]
mod sys;
#[cfg(windows)]
mod work;

#[cfg(windows)]
fn main() {
    std::process::exit(app::run());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Rig Setup runs on Windows. To look at its screens, open ui/index.html in a browser.");
    std::process::exit(1);
}
