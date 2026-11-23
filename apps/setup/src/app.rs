//! The window: a small frameless one showing ui/index.html in WebView2, the
//! browser engine the Rig app itself runs in. The page asks for things with
//! window.ipc.postMessage; the window answers with rig.show(view).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Icon, WindowBuilder};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows};

use crate::args::{self, Mode};
use crate::payload::{self, Payload};
use crate::progress::Step;
use crate::version;
use crate::sys;
use crate::work;

const PAGE: &str = include_str!(concat!(env!("OUT_DIR"), "/index.html"));
/// --bg in packages/ui/src/styles/tokens.css, so the window never flashes white.
const BG: (u8, u8, u8, u8) = (0xF2, 0xF0, 0xEC, 0xFF);

enum Kind {
    Install(Payload),
    Uninstall(PathBuf),
    /// Setup can't go ahead; the window says why.
    Broken(String),
    Preview(String),
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct View {
    mode: &'static str,
    screen: &'static str,
    version: String,
    installed: Option<String>,
    rig_open: bool,
    progress: f64,
    step: Step,
    recorder_off: bool,
    wiped: bool,
    error: String,
}

enum Msg {
    Page(String),
    Progress(Step, f64),
    Installed(Result<work::Done, String>),
    Uninstalled(Result<bool, String>),
}

#[derive(Deserialize)]
struct Ask {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    desktop: bool,
    #[serde(default)]
    wipe: bool,
}

fn temp(prefix: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("{prefix}-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&d);
    d
}

pub fn run() -> i32 {
    let line = sys::command_line();
    let exe = std::env::current_exe().unwrap_or_default();
    let here = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    match args::parse(args::after_program(&line)) {
        Mode::QuietInstall(flags) => {
            let Ok(Some(p)) = payload::find(&exe) else { return 2 };
            let tmp = temp("RigSetup");
            let code = work::quiet_install(&exe, &p, &tmp, &flags);
            let _ = std::fs::remove_dir_all(&tmp);
            code
        }
        Mode::QuietUninstall(flags) => work::quiet_uninstall(&here, &flags),
        Mode::Uninstall { dir, from_temp } => {
            let dir = dir.or_else(|| sys::installed().map(|i| i.dir)).unwrap_or(here);
            if !from_temp {
                if let Some(code) = from_a_copy(&exe, &dir) {
                    return code;
                }
            }
            window(Kind::Uninstall(dir), &exe)
        }
        Mode::Install => match payload::find(&exe) {
            Ok(Some(p)) => window(Kind::Install(p), &exe),
            Ok(None) => window(Kind::Broken("This copy of Rig Setup has no installer inside it. Download Rig again from rigpc.app.".into()), &exe),
            Err(e) => window(Kind::Broken(e.to_string()), &exe),
        },
        Mode::Preview(name) => window(Kind::Preview(name), &exe),
    }
}

/// The uninstaller lives in Rig's folder, which it's about to empty, so it
/// runs from a copy in the temp folder instead. Returns None if it can't.
fn from_a_copy(exe: &Path, dir: &Path) -> Option<i32> {
    use std::os::windows::process::CommandExt;
    let copy = temp("RigUninstall").join("rig-uninstall.exe");
    std::fs::copy(exe, &copy).ok()?;
    let mut line = std::ffi::OsString::from("--uninstall --dir \"");
    line.push(dir.as_os_str());
    line.push("\" --from-temp");
    // Exits straight away, as Windows' Settings expects, so this exe can be deleted too.
    std::process::Command::new(&copy).raw_arg(&line).spawn().ok().map(|_| 0)
}

/// Without WebView2 (rare: it ships with Windows 10 and 11), setup can't draw
/// its window, so the stock installer or uninstaller runs instead.
fn without_a_window(kind: &Kind, exe: &Path) -> i32 {
    // CI expects the Rig window; the stock wizard would wait for a click that never comes.
    if std::env::var_os("RIG_SETUP_AUTO").is_some() {
        return 3;
    }
    match kind {
        Kind::Install(p) => {
            let tmp = temp("RigSetup");
            let installer = tmp.join(format!("Rig_{}_x64-setup.exe", p.meta.version));
            let code = if payload::extract(exe, p, &installer).is_ok() { work::plain(&installer) } else { 2 };
            let _ = std::fs::remove_dir_all(&tmp);
            code
        }
        Kind::Uninstall(dir) => work::plain(&dir.join("uninstall.exe")),
        _ => 1,
    }
}

fn window(kind: Kind, exe: &Path) -> i32 {
    if wry::webview_version().is_err() {
        return without_a_window(&kind, exe);
    }
    // Setup's own scratch folder, deleted when it exits. An uninstaller running
    // from its copy in the temp folder deletes that whole copy; one that couldn't
    // copy itself must never touch the folder it's in, which is Rig's.
    let tmp = match (&kind, exe.parent()) {
        (Kind::Uninstall(_), Some(p)) if p.starts_with(std::env::temp_dir()) && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("RigUninstall-")) => p.to_path_buf(),
        (Kind::Uninstall(_), _) => temp("RigUninstall"),
        _ => temp("RigSetup"),
    };
    // Set by CI: press the main button without anyone there, and exit with the result.
    let auto = std::env::var_os("RIG_SETUP_AUTO").is_some();
    let installed = sys::installed();
    let mut view = View {
        mode: if matches!(kind, Kind::Uninstall(_)) { "uninstall" } else { "install" },
        screen: "welcome",
        version: String::new(),
        installed: installed.as_ref().map(|i| i.version.clone()),
        rig_open: false,
        progress: 0.0,
        step: Step::Files,
        recorder_off: false,
        wiped: false,
        error: String::new(),
    };
    match &kind {
        Kind::Install(p) => {
            view.version = p.meta.version.clone();
            if installed.as_ref().is_some_and(|i| version::newer(&i.version, &p.meta.version)) {
                view.screen = "newer";
            }
        }
        Kind::Uninstall(_) => view.version = view.installed.clone().unwrap_or_default(),
        Kind::Broken(why) => {
            view.screen = "error";
            view.error = why.clone();
        }
        Kind::Preview(_) => {}
    }

    let event_loop = EventLoopBuilder::<Msg>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let title = if view.mode == "install" { "Rig Setup" } else { "Uninstall Rig" };
    let built = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(600.0, 480.0))
        .with_resizable(false)
        .with_maximizable(false)
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .with_visible(false)
        .with_window_icon(Icon::from_resource(1, None).ok())
        .build(&event_loop);
    let Ok(window) = built else { return without_a_window(&kind, exe) };
    sys::round_corners(window.hwnd());
    if let Some(m) = window.current_monitor().or_else(|| event_loop.primary_monitor()) {
        let (ms, mp, ws) = (m.size(), m.position(), window.outer_size());
        window.set_outer_position(PhysicalPosition::new(
            mp.x + (ms.width as i32 - ws.width as i32) / 2,
            mp.y + (ms.height as i32 - ws.height as i32) / 2,
        ));
    }

    let mut context = WebContext::new(Some(tmp.join("webview")));
    let to_loop = proxy.clone();
    let built = WebViewBuilder::new_with_web_context(&mut context)
        .with_html(PAGE)
        .with_background_color(BG)
        .with_devtools(false)
        .with_hotkeys_zoom(false)
        .with_browser_accelerator_keys(false)
        .with_default_context_menus(false)
        .with_ipc_handler(move |req| {
            let _ = to_loop.send_event(Msg::Page(req.into_body()));
        })
        .build(&window);
    let Ok(webview) = built else {
        drop(window);
        return without_a_window(&kind, exe);
    };

    let exe = exe.to_path_buf();
    let mut busy = false;
    let push = |webview: &wry::WebView, v: &View| {
        let _ = webview.evaluate_script(&format!("rig.show({})", serde_json::to_string(v).unwrap_or_default()));
    };
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        // The context lives as long as the loop, which is as long as the webview.
        let _ = &context;
        let leave = |flow: &mut ControlFlow, code: i32| {
            sys::delete_after_exit(&tmp);
            *flow = ControlFlow::ExitWithCode(code);
        };
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } if !busy => leave(flow, 1),
            Event::UserEvent(Msg::Progress(step, p)) => {
                view.step = step;
                view.progress = p;
                push(&webview, &view);
            }
            Event::UserEvent(Msg::Installed(r)) => {
                busy = false;
                match r {
                    Ok(done) => {
                        view.screen = "done";
                        view.progress = 1.0;
                        view.recorder_off = done.recorder_off;
                    }
                    Err(e) => {
                        view.screen = "error";
                        view.error = e;
                    }
                }
                push(&webview, &view);
                if auto {
                    leave(flow, if view.screen == "done" { 0 } else { 1 });
                }
            }
            Event::UserEvent(Msg::Uninstalled(r)) => {
                busy = false;
                match r {
                    Ok(wiped) => {
                        view.screen = "done";
                        view.wiped = wiped;
                    }
                    Err(e) => {
                        view.screen = "error";
                        view.error = e;
                    }
                }
                push(&webview, &view);
                if auto {
                    leave(flow, if view.screen == "done" { 0 } else { 1 });
                }
            }
            Event::UserEvent(Msg::Page(text)) => {
                let Ok(ask) = serde_json::from_str::<Ask>(&text) else { return };
                match ask.kind.as_str() {
                    "ready" => {
                        if let Kind::Preview(name) = &kind {
                            let _ = webview.evaluate_script(&format!("rig.preview({})", serde_json::to_string(name).unwrap_or_default()));
                        } else {
                            view.rig_open = sys::rig_is_open();
                            push(&webview, &view);
                        }
                        window.set_visible(true);
                        window.set_focus();
                        if auto {
                            match &kind {
                                // Leave the switches as people first see them.
                                Kind::Install(_) => { let _ = proxy.send_event(Msg::Page(r#"{"type":"install","desktop":true}"#.into())); }
                                Kind::Uninstall(_) => { let _ = proxy.send_event(Msg::Page(r#"{"type":"uninstall"}"#.into())); }
                                Kind::Broken(_) => leave(flow, 1),
                                Kind::Preview(_) => {}
                            }
                        }
                    }
                    "drag" => {
                        let _ = window.drag_window();
                    }
                    "minimize" => window.set_minimized(true),
                    "close" if !busy => leave(flow, if view.screen == "done" { 0 } else { 1 }),
                    "open" if !busy => {
                        let dir = sys::installed().map_or_else(sys::default_dir, |i| i.dir);
                        let _ = std::process::Command::new(dir.join("Rig.exe")).current_dir(&dir).spawn();
                        leave(flow, 0);
                    }
                    "install" if !busy && matches!(view.screen, "welcome" | "error") => {
                        let Kind::Install(p) = &kind else { return };
                        busy = true;
                        view.screen = "working";
                        view.progress = 0.03;
                        view.step = Step::Files;
                        push(&webview, &view);
                        let (exe, p, tmp, before, proxy) = (exe.clone(), p.clone(), tmp.clone(), installed.clone(), proxy.clone());
                        let desktop = ask.desktop;
                        std::thread::spawn(move || {
                            let tell = proxy.clone();
                            let r = work::install(&exe, &p, &tmp, before.as_ref(), desktop, move |s, v| {
                                let _ = tell.send_event(Msg::Progress(s, v));
                            });
                            let _ = proxy.send_event(Msg::Installed(r));
                        });
                    }
                    "uninstall" if !busy && matches!(view.screen, "welcome" | "error") => {
                        let Kind::Uninstall(dir) = &kind else { return };
                        busy = true;
                        view.screen = "working";
                        view.progress = 0.03;
                        view.step = Step::Removing;
                        push(&webview, &view);
                        let (dir, proxy, wipe) = (dir.clone(), proxy.clone(), ask.wipe);
                        std::thread::spawn(move || {
                            let tell = proxy.clone();
                            let r = work::uninstall(&dir, wipe, move |s, v| {
                                let _ = tell.send_event(Msg::Progress(s, v));
                            });
                            let _ = proxy.send_event(Msg::Uninstalled(r.map(|_| wipe)));
                        });
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    })
}
