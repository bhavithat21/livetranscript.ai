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
// Phase 2 (not yet wired): a native WASAPI loopback command for silent
// full-system audio capture with no screen-share picker — would register a
// #[tauri::command] here and feed PCM to the web layer via an additive,
// feature-detected bridge.

// Toggle OS-level screen-capture exclusion at runtime (Windows
// WDA_EXCLUDEFROMCAPTURE / macOS sharingType=none). The window is created with
// contentProtected=true, so it's hidden from screen shares by default; this lets
// the web UI flip it (e.g. a "visible to me only" switch). Feature-detected on the
// JS side via window.__TAURI__ so the browser build ignores it.
#[tauri::command]
fn set_content_protection(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window.set_content_protected(enabled).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_content_protection])
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
