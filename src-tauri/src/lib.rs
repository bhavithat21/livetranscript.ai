// LiveTranscript desktop shell (Tauri v2).
//
// This is a THIN native wrapper: the window loads the already-deployed web app
// (https://livetranscript.ai, set as `frontendDist` in tauri.conf.json). The web
// app is untouched — this crate adds only the native window + OS integration.
//
// Mic and screen/tab-audio permission prompts are handled by the platform webview
// automatically (WKWebView on macOS, WebView2 on Windows), so live transcription
// and system-audio capture work the same as in the browser.
//
// Native system-audio capture: silent full-system audio with no screen-share
// picker. macOS uses a ScreenCaptureKit Swift sidecar (macos_capture); Windows
// uses cpal WASAPI loopback (windows_capture). Both are passive taps — they
// never seize the mic/output device, so Zoom keeps working with no echo. Frames
// reach the web layer via an additive, feature-detected bridge
// (lib/audio/useNativeCapture.ts).
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};

#[cfg(target_os = "macos")]
mod macos_capture;
#[cfg(target_os = "windows")]
mod windows_capture;

// A capture session's teardown handle: calling it stops THAT session's capture
// (macOS: kills the sidecar; Windows: drops the cpal stream). Each start()
// returns its own stopper, so a stop→start race can't resurrect a retired
// session — the old one is fully torn down before a new one is stored.
type Stopper = Box<dyn FnOnce() + Send>;

#[derive(Default)]
pub struct AudioState {
    session: Mutex<Option<Stopper>>,
}

// Mirrors the window's contentProtected flag so the tray menu's checkmark stays
// in sync with whatever the web UI (or the tray item itself) last set. The window
// is created with contentProtected=true, so this starts true.
pub struct ProtectionState {
    hidden_from_capture: Mutex<bool>,
}
impl Default for ProtectionState {
    fn default() -> Self {
        Self { hidden_from_capture: Mutex::new(true) }
    }
}

// Holds the tray's checkable "Hidden from screen share" item so apply_protection
// can tick/untick it when the flag changes from anywhere. Empty until setup builds
// the tray; empty on non-desktop targets (no tray there).
#[cfg(desktop)]
#[derive(Default)]
pub struct TrayHandles {
    protection_item: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>,
}

// Trigger every OS permission the app needs UP FRONT (called once at launch by
// the web layer's PermissionPrimer) so the user is never interrupted mid-session.
// On macOS this fires the Screen-Recording TCC prompt via CoreGraphics WITHOUT
// capturing anything (the silent system-audio sidecar needs that grant). The mic
// prompt is driven from JS (getUserMedia) since it belongs to the webview.
// Returns whether screen-capture access is granted. No-op / true off macOS.
#[cfg(target_os = "macos")]
#[tauri::command]
fn request_screen_capture_access() -> bool {
    // Linked from the OS; the standard TCC entry points for Screen Recording.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    unsafe {
        // Already granted? Don't re-prompt.
        if CGPreflightScreenCaptureAccess() {
            return true;
        }
        // Not granted → show the prompt. Note: macOS only applies a fresh grant
        // after the app is restarted, so the very first capture may still need one
        // relaunch — but the user is asked here, at launch, not mid-recording.
        CGRequestScreenCaptureAccess()
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn request_screen_capture_access() -> bool {
    // Windows loopback capture needs no OS permission; nothing to request.
    true
}

// Toggle OS-level screen-capture exclusion at runtime (Windows
// WDA_EXCLUDEFROMCAPTURE / macOS sharingType=none). The window is created with
// contentProtected=true, so it's hidden from screen shares by default; this lets
// the web UI flip it (e.g. a "visible to me only" switch). Feature-detected on the
// JS side via window.__TAURI__ so the browser build ignores it.
#[tauri::command]
fn set_content_protection(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    apply_protection(&app, enabled)
}

// Single source of truth for the screen-share-hide flag: sets it on the window,
// records it in ProtectionState, and syncs the tray menu's checkmark. Called both
// by the web UI (set_content_protection command) and the tray menu item, so the
// two never drift.
#[cfg(desktop)]
fn apply_protection(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        win.set_content_protected(enabled).map_err(|e| e.to_string())?;
    }
    let state = app.state::<ProtectionState>();
    *state.hidden_from_capture.lock().unwrap() = enabled;
    if let Some(item) = app.state::<TrayHandles>().protection_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(enabled);
    }
    Ok(())
}

#[cfg(not(desktop))]
fn apply_protection(_app: &tauri::AppHandle, _enabled: bool) -> Result<(), String> {
    Ok(())
}

// Start native system-audio capture. Returns the PCM sample rate (Hz); the
// frontend passes it to the STT provider. Emits 16-bit little-endian mono PCM
// frames over `on_frame` (arrive as ArrayBuffer in JS).
//
// A previous session is torn down first (stop is idempotent), then a fresh
// per-session flag is created and handed to the platform capture, which BLOCKS
// until capture is confirmed live (or returns Err). So a returned Ok means audio
// is really flowing — the frontend can trust it and skip the browser fallback.
#[tauri::command]
fn start_native_audio(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AudioState>,
    _on_frame: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    // Retire any prior session before starting a new one (handles fast restart
    // and a stuck session) so we never run two captures at once.
    stop_session(&state);

    #[cfg(target_os = "macos")]
    let result = macos_capture::start(_app, _on_frame);
    #[cfg(target_os = "windows")]
    let result = windows_capture::start(_on_frame);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result: Result<(u32, Stopper), String> = {
        let _ = _on_frame;
        Err("native capture not supported on this platform".into())
    };

    let (rate, stopper) = result?;
    *state.session.lock().unwrap() = Some(stopper);
    Ok(rate)
}

// Stop native capture: tear down the current session (macOS kills the sidecar;
// Windows drops the cpal stream). Idempotent.
#[tauri::command]
fn stop_native_audio(state: tauri::State<'_, AudioState>) {
    stop_session(&state);
}

// Retire the active session, if any, by invoking its teardown handle.
fn stop_session(state: &AudioState) {
    let stopper = state.session.lock().unwrap().take();
    if let Some(stop) = stopper {
        stop();
    }
}

// Panic-hide global shortcut: CmdOrCtrl+Shift+H toggles the window's visibility
// even when the app is NOT focused (that's why it's a native global shortcut, not
// a web keydown listener). One keystroke pulls the overlay off-screen during a
// screen share and brings it back. Desktop-only; the browser build never sees it.
#[cfg(desktop)]
fn toggle_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        // is_visible can fail on some platforms; treat an error as "assume hidden"
        // so the shortcut still reveals the window rather than doing nothing.
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

// Build the menu-bar / system-tray icon and its menu. Tray-only mode means this
// is the app's primary control surface, so the menu carries everything the user
// needs: show/hide the window, toggle screen-share hiding (a checkbox that tracks
// the real state), and quit (the only way out with no Dock/taskbar icon).
// Left-clicking the icon itself toggles the window, matching the panic-hide hotkey.
#[cfg(desktop)]
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show = MenuItem::with_id(app, "show_hide", "Show / Hide Window", true, None::<&str>)?;
    let protect_on = *app.state::<ProtectionState>().hidden_from_capture.lock().unwrap();
    let protect = CheckMenuItem::with_id(
        app,
        "toggle_protection",
        "Hidden from screen share",
        true,
        protect_on,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit LiveTranscript", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &protect, &quit])?;

    // Stash the checkbox so apply_protection can keep it in sync with the flag.
    *app.state::<TrayHandles>().protection_item.lock().unwrap() = Some(protect.clone());

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("LiveTranscript")
        .menu(&menu)
        // Only the menu should open on left-click behavior differences across OSes;
        // we also toggle the window on a plain left click for quick access.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_hide" => toggle_main_window(app),
            "toggle_protection" => {
                let current = *app.state::<ProtectionState>().hidden_from_capture.lock().unwrap();
                let _ = apply_protection(app, !current);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, .. } = event {
                use tauri::tray::{MouseButton, MouseButtonState};
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_main_window(tray.app_handle());
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init()); // spawn the macOS ScreenCaptureKit sidecar

    // Global-shortcut plugin (desktop only) — the panic-hide hotkey is registered
    // in setup() below via on_shortcut so it fires even when the app is unfocused.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    let builder = builder
        .manage(AudioState::default())
        .manage(ProtectionState::default());
    #[cfg(desktop)]
    let builder = builder.manage(TrayHandles::default());

    builder
        .invoke_handler(tauri::generate_handler![
            set_content_protection,
            request_screen_capture_access,
            start_native_audio,
            stop_native_audio
        ])
        // Auto-update the NATIVE SHELL. Note the web UI already updates on every
        // launch (frontendDist is the remote site); this keeps the wrapper current.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Check for a shell update in the background on launch; install silently
            // and relaunch. Desktop-only (updater isn't built on mobile targets).
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    check_for_update(handle).await;
                });

                // Panic-hide: CmdOrCtrl+Shift+H toggles window visibility globally.
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                // Cmd on macOS, Ctrl elsewhere (SUPER is the Windows key on Windows).
                #[cfg(target_os = "macos")]
                let primary = Modifiers::SUPER;
                #[cfg(not(target_os = "macos"))]
                let primary = Modifiers::CONTROL;
                let panic_hide = Shortcut::new(Some(Modifiers::SHIFT | primary), Code::KeyH);
                app.global_shortcut()
                    .on_shortcut(panic_hide, move |app, shortcut, event| {
                        if event.state == ShortcutState::Pressed && shortcut == &panic_hide {
                            toggle_main_window(app);
                        }
                    })
                    // Fail-soft: if the OS refuses the hotkey (already taken), the app
                    // still runs — the in-app "?" sheet documents the shortcut anyway.
                    .ok();

                // Tray-only mode: no Dock icon on macOS (Accessory policy), no
                // taskbar button on Windows (skipTaskbar in tauri.conf.json). The
                // app lives entirely in the menu bar / system tray.
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                if let Err(e) = build_tray(app.handle()) {
                    eprintln!("[tray] failed to build tray icon: {e}");
                }

                // Windows 11: real desktop blur behind the transparent window.
                // CSS backdrop-filter only blurs in-page content, never the OS
                // desktop behind a transparent WebView2 — this calls the native
                // DWM acrylic API so the glass overlay matches the macOS vibrancy.
                // Fail-soft: pre-Win11 / unsupported → no blur, window still works.
                #[cfg(target_os = "windows")]
                {
                    use tauri::Manager;
                    if let Some(win) = app.get_webview_window("main") {
                        // Dark tint (18,18,26) at ~80% to match the lt-desktop theme.
                        let _ = window_vibrancy::apply_acrylic(&win, Some((18, 18, 26, 200)));
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LiveTranscript desktop");
}

#[cfg(desktop)]
async fn check_for_update(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    // Fail-soft: any error (offline, no release yet, endpoint down) just skips the
    // update — the app runs fine on the current version.
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => return,
    };
    if let Ok(Some(update)) = updater.check().await {
        let _ = update.download_and_install(|_chunk, _total| {}, || {}).await;
    }
}
