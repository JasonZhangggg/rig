// Puts the font into the page (the window loads it as a string, with no files
// next to it), and gives the exe Rig's icon and a manifest on Windows.
use std::{env, fs, path::Path};

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

fn main() {
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-changed=../desktop/src-tauri/tauri.conf.json");
    let html = fs::read_to_string("ui/index.html").expect("ui/index.html");
    let font = fs::read("ui/inter-tight.woff2").expect("ui/inter-tight.woff2");
    let from = "url(inter-tight.woff2)";
    assert!(html.contains(from), "index.html should load the font from {from}");
    let html = html.replace(from, &format!("url(data:font/woff2;base64,{})", base64(&font)));
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("index.html"), html).unwrap();

    // Resources need Windows' resource compiler, so a check from another system skips them.
    if cfg!(windows) && env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = tauri_winres::WindowsResource::new();
        res.set_icon_with_id("../desktop/src-tauri/icons/icon.ico", "1");
        res.set("FileDescription", "Rig Setup");
        res.set("ProductName", "Rig");
        // Properties > Details shows Rig's version, not this crate's 0.0.0.
        let conf = fs::read_to_string("../desktop/src-tauri/tauri.conf.json").expect("tauri.conf.json");
        let version = conf.split("\"version\"").nth(1).and_then(|r| r.split('"').nth(1)).expect("a version in tauri.conf.json");
        res.set("ProductVersion", version);
        res.set("FileVersion", version);
        res.set_manifest(include_str!("setup.manifest"));
        res.compile().expect("Windows resources");
    }
}
