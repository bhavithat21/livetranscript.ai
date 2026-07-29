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

// Poison-tolerant lock. A panic while holding one of our mutexes would otherwise
// poison it, and every later `.lock().unwrap()` would then panic too — cascading
// one failure across all IPC calls that touch the same state. Our guarded data
// (a stopper handle, a bool, a tray handle) is always safe to keep using after a
// panic, so we recover the inner value instead of propagating the poison.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

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

// Lock (click-through) mode: the window stays visible + always-on-top but ignores
// all cursor events, so the user works in the apps BEHIND it while the transcript/
// AI floats on top, view-only. CRITICAL: while locked the window can't be clicked,
// so the ONLY ways out are the global hotkey (works unfocused) and the tray item —
// never an in-window control. This flag mirrors the window state so the tray
// checkmark and the hotkey toggle agree. Starts unlocked.
pub struct LockState {
    click_through: Mutex<bool>,
}
impl Default for LockState {
    fn default() -> Self {
        Self { click_through: Mutex::new(false) }
    }
}

// Holds the tray's checkable items so their state can be synced when the
// underlying flag changes from anywhere (webview IPC, tray click, hotkey). Empty
// until setup builds the tray; empty on non-desktop targets (no tray there).
#[cfg(desktop)]
#[derive(Default)]
pub struct TrayHandles {
    protection_item: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>,
    lock_item: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>,
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
    // macOS 15+: the sidecar uses a CoreAudio process tap, whose "System Audio
    // Recording Only" permission is prompted by the OS on first capture and never
    // re-confirmed — Screen Recording isn't needed, so don't fire its TCC prompt
    // (that prompt is the recurring launch nag this build removes).
    if macos_major_version() >= 15 {
        return true;
    }
    // Linked from the OS; the standard TCC entry points for Screen Recording.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    // SAFETY: Both symbols are stable CoreGraphics C functions present on macOS
    // 10.15+ (this app targets far newer). They take no arguments, return a plain
    // BOOL, have no preconditions, and are safe to call from any thread. We only
    // reach here on macOS (cfg above), so the framework is always linked.
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

// Major macOS version (e.g. 15 for Sequoia) from the kernel, no deprecated APIs.
// sysctl "kern.osproductversion" returns "15.3.1"-style strings on 10.13+.
#[cfg(target_os = "macos")]
fn macos_major_version() -> u32 {
    std::process::Command::new("sysctl")
        .args(["-n", "kern.osproductversion"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().split('.').next().and_then(|v| v.parse().ok()))
        .unwrap_or(0) // unknown → 0 → keep the legacy Screen-Recording prompt path
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
    // Hold the flag lock across the whole read-modify-write so a concurrent
    // toggle (tray vs. webview IPC) can't interleave and leave window state, the
    // stored flag, and the tray checkmark disagreeing (TOCTOU).
    let state = app.state::<ProtectionState>();
    let mut guard = lock(&state.hidden_from_capture);
    if let Some(win) = app.get_webview_window("main") {
        win.set_content_protected(enabled).map_err(|e| e.to_string())?;
    }
    *guard = enabled;
    if let Some(item) = lock(&app.state::<TrayHandles>().protection_item).as_ref() {
        let _ = item.set_checked(enabled);
    }
    Ok(())
}

// Flip the screen-share-hide flag atomically: reads the current value and writes
// its inverse under a single lock hold, so two rapid toggles can't both read the
// same "before" value. Used by the tray menu item.
#[cfg(desktop)]
fn toggle_protection(app: &tauri::AppHandle) {
    use tauri::Manager;
    let next = {
        let state = app.state::<ProtectionState>();
        let guard = lock(&state.hidden_from_capture);
        !*guard
    };
    let _ = apply_protection(app, next);
}

#[cfg(not(desktop))]
fn apply_protection(_app: &tauri::AppHandle, _enabled: bool) -> Result<(), String> {
    Ok(())
}

// Lock (click-through) mode, callable from the web UI's in-app button. Turning it
// ON makes the overlay pass all mouse/keyboard through to whatever is behind it
// AND pins it always-on-top, so the user keeps working in other apps with the
// transcript floating above. Turning it OFF restores normal interaction.
#[tauri::command]
fn set_lock_mode(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    apply_lock(&app, enabled)
}

// Read the current lock state so the web UI can reflect it (e.g. show the right
// button label) and stay in sync after a hotkey/tray toggle.
#[tauri::command]
fn get_lock_mode(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    *lock(&app.state::<LockState>().click_through)
}

// Single source of truth for lock mode: sets ignore-cursor-events + always-on-top
// on the window, records the flag, and syncs the tray checkmark — so the webview
// button, tray item, and hotkey never drift. Always-on-top is only ADDED with
// lock (so the view-only overlay stays visible over other apps) and removed on
// unlock, restoring normal stacking.
#[cfg(desktop)]
fn apply_lock(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<LockState>();
    // Hold the flag lock across the whole read-modify-write so a concurrent toggle
    // (tray vs hotkey vs webview IPC) can't leave window state and flag disagreeing.
    let mut guard = lock(&state.click_through);
    if let Some(win) = app.get_webview_window("main") {
        win.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())?;
        win.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    }
    *guard = enabled;
    if let Some(item) = lock(&app.state::<TrayHandles>().lock_item).as_ref() {
        let _ = item.set_checked(enabled);
    }
    // Scroll-while-locked: a click-through window can't receive wheel events, so
    // register GLOBAL CmdOrCtrl+Shift+Up/Down only while locked (they're common
    // editing shortcuts — never hold them when unlocked) and emit to the webview.
    apply_lock_scroll_hotkeys(app, enabled);
    Ok(())
}

// Register/release the lock-scroll hotkeys with lock mode. Fail-soft like the
// other shortcuts: an OS refusal (hotkey taken) just means no scroll-while-locked.
#[cfg(desktop)]
fn apply_lock_scroll_hotkeys(app: &tauri::AppHandle, enabled: bool) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
    #[cfg(target_os = "macos")]
    let primary = Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let primary = Modifiers::CONTROL;
    let up = Shortcut::new(Some(Modifiers::SHIFT | primary), Code::ArrowUp);
    let down = Shortcut::new(Some(Modifiers::SHIFT | primary), Code::ArrowDown);
    if enabled {
        for (sc, dir) in [(up, "up"), (down, "down")] {
            let _ = app.global_shortcut().on_shortcut(sc, move |app, shortcut, event| {
                use tauri::Emitter;
                if event.state == ShortcutState::Pressed && shortcut == &sc {
                    let _ = app.emit("lock-scroll", dir);
                }
            });
        }
    } else {
        let _ = app.global_shortcut().unregister(up);
        let _ = app.global_shortcut().unregister(down);
    }
}

// Flip lock mode atomically (reads current, writes inverse under one lock hold).
// Used by the tray item and the global unlock hotkey.
#[cfg(desktop)]
fn toggle_lock(app: &tauri::AppHandle) {
    use tauri::Manager;
    let next = {
        let state = app.state::<LockState>();
        let guard = lock(&state.click_through);
        !*guard
    };
    let _ = apply_lock(app, next);
}

#[cfg(not(desktop))]
fn apply_lock(_app: &tauri::AppHandle, _enabled: bool) -> Result<(), String> {
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
    *lock(&state.session) = Some(stopper);
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
    let stopper = lock(&state.session).take();
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
        // A minimized window still reports is_visible()==true on Windows, so the old
        // "visible → hide" branch would hide an already-minimized window instead of
        // restoring it — and with skipTaskbar there's no taskbar button to click,
        // leaving it unrecoverable. Treat minimized as "needs restore": unminimize +
        // focus. is_visible/is_minimized can fail on some platforms; on error assume
        // hidden and reveal, so the shortcut always errs toward showing the window.
        let minimized = win.is_minimized().unwrap_or(false);
        match win.is_visible() {
            Ok(true) if !minimized => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.unminimize();
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
    let protect_on = *lock(&app.state::<ProtectionState>().hidden_from_capture);
    let protect = CheckMenuItem::with_id(
        app,
        "toggle_protection",
        "Hidden from screen share",
        true,
        protect_on,
        None::<&str>,
    )?;
    // Manual update: tray-only apps have no window chrome for a button, so the
    // "Check for Updates" control lives here — always reachable, even when hidden.
    // Lock (click-through) mode: toggle here or via the global hotkey. This is the
    // primary UNLOCK path — a locked window can't be clicked, so the tray + hotkey
    // are the only ways back to interactive.
    let lock_on = *lock(&app.state::<LockState>().click_through);
    let lock_item = CheckMenuItem::with_id(
        app,
        "toggle_lock",
        "Lock (click-through) mode",
        true,
        lock_on,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "check_update", "Check for Updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LiveTranscript", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &protect, &lock_item, &update, &quit])?;

    // Stash the checkboxes so apply_protection / apply_lock keep them in sync.
    *lock(&app.state::<TrayHandles>().protection_item) = Some(protect.clone());
    *lock(&app.state::<TrayHandles>().lock_item) = Some(lock_item.clone());

    // The window icon is the tray icon. If it's somehow absent (bad bundle), fall
    // back to a build error rather than unwrap-panicking inside setup() — a panic
    // here, after Accessory policy could have hidden the Dock, would leave a
    // headless app with no way to quit.
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("LiveTranscript")
        .menu(&menu)
        // Only the menu should open on left-click behavior differences across OSes;
        // we also toggle the window on a plain left click for quick access.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_hide" => toggle_main_window(app),
            "toggle_protection" => toggle_protection(app),
            "toggle_lock" => toggle_lock(app),
            "check_update" => {
                // Manual update check from the tray. Runs off the UI thread; shows
                // the window so the user sees progress / any error, then installs.
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    run_update_check(handle, true).await;
                });
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
        .manage(ProtectionState::default())
        .manage(LockState::default());
    #[cfg(desktop)]
    let builder = builder.manage(TrayHandles::default());

    builder
        .invoke_handler(tauri::generate_handler![
            set_content_protection,
            set_lock_mode,
            get_lock_mode,
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
                    run_update_check(handle, false).await; // silent on launch
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

                // Lock toggle: CmdOrCtrl+Shift+L. This is the ESCAPE HATCH — a
                // click-through locked window can't be clicked, so a GLOBAL hotkey
                // (fires even when the window is ignoring the cursor / unfocused) is
                // the guaranteed way back to interactive. Also togglable from the tray.
                let lock_toggle = Shortcut::new(Some(Modifiers::SHIFT | primary), Code::KeyL);
                app.global_shortcut()
                    .on_shortcut(lock_toggle, move |app, shortcut, event| {
                        if event.state == ShortcutState::Pressed && shortcut == &lock_toggle {
                            // Must leave the shortcut dispatch thread before calling
                            // toggle_lock — it unregisters shortcuts, which would
                            // deadlock on the plugin's internal lock.
                            let handle = app.clone();
                            std::thread::spawn(move || toggle_lock(&handle));
                        }
                    })
                    .ok();

                // Tray-only mode: build the tray FIRST, then hide the Dock icon
                // (macOS Accessory policy; Windows uses skipTaskbar in the config).
                // Order matters: if the tray fails to build, we must NOT demote to
                // Accessory — otherwise the app would have neither a Dock icon nor a
                // tray, leaving it headless with no way to show or quit it.
                match build_tray(app.handle()) {
                    Ok(()) => {
                        #[cfg(target_os = "macos")]
                        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                    Err(e) => {
                        // Keep the Dock icon (default Regular policy) so the app is
                        // still reachable and quittable despite the missing tray.
                        eprintln!("[tray] failed to build tray icon, keeping Dock icon: {e}");
                    }
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

// Check for a shell update and install it if found. `manual` = triggered from the
// tray "Check for Updates" item: reveal the window so the user sees progress, and
// log the outcome (up-to-date / error) so the click isn't a silent no-op. The
// launch-time call passes manual=false (fully silent, fail-soft).
#[cfg(desktop)]
async fn run_update_check(app: tauri::AppHandle, manual: bool) {
    use tauri::Manager;
    use tauri_plugin_updater::UpdaterExt;

    if manual {
        // Bring the window forward so any progress/error is visible.
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }

    // Fail-soft: any error (offline, no release yet, endpoint down) just skips —
    // the app keeps running on the current version.
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            if manual {
                eprintln!("[updater] unavailable: {e}");
            }
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            // Newer version available → download + install, then the app relaunches.
            let _ = update.download_and_install(|_chunk, _total| {}, || {}).await;
        }
        Ok(None) => {
            if manual {
                eprintln!("[updater] already up to date");
            }
        }
        Err(e) => {
            if manual {
                eprintln!("[updater] check failed: {e}");
            }
        }
    }
}
