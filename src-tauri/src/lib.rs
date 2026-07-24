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

// Toggle OS-level screen-capture exclusion at runtime (Windows
// WDA_EXCLUDEFROMCAPTURE / macOS sharingType=none). The window is created with
// contentProtected=true, so it's hidden from screen shares by default; this lets
// the web UI flip it (e.g. a "visible to me only" switch). Feature-detected on the
// JS side via window.__TAURI__ so the browser build ignores it.
#[tauri::command]
fn set_content_protection(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window.set_content_protected(enabled).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init()) // spawn the macOS ScreenCaptureKit sidecar
        .manage(AudioState::default())
        .invoke_handler(tauri::generate_handler![
            set_content_protection,
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
