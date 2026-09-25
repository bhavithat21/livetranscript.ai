//! Explicitly selected, read-only native repository observation. No input APIs.
//! A short-lived capability binds every frame to one selected display and the
//! trusted main webview. Polling alone cannot start capture or change targets.
use serde::Serialize;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tauri::Manager;

#[derive(Default)]
pub struct RepoCaptureState { session: Mutex<Option<Arc<Session>>> }
struct Session { token: String, display: DisplayInfo, started: Instant, stopped: AtomicBool, busy: AtomicBool, gate: Mutex<Gate> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo { id: String, name: String, width: u32, height: u32 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease { token: String, display: DisplayInfo, expires_after_ms: u64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame { bytes: Vec<u8>, mime: &'static str, width: u32, height: u32 }
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }

fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "Cannot verify the desktop window".to_string())?;
    let production = url.scheme() == "https" && url.host_str() == Some("livetranscript.ai") && url.port_or_known_default() == Some(443);
    #[cfg(debug_assertions)]
    let production = production || (url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost")));
    if window.label() != "main" || !production { return Err("Capture is restricted to the trusted desktop app".into()); }
    Ok(())
}
fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> { value.lock().unwrap_or_else(|p| p.into_inner()) }
pub fn stop_for_exit(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<RepoCaptureState>() {
        if let Some(session) = lock(&state.session).take() { session.stopped.store(true, Ordering::Release); }
    }
}
#[tauri::command]
pub async fn repo_capture_displays(window: tauri::WebviewWindow) -> Result<Vec<DisplayInfo>, String> {
    trusted(&window)?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return tauri::async_runtime::spawn_blocking(platform::displays).await.map_err(|_| "Display discovery stopped".to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("Native repository capture supports macOS and Windows".into())
}
#[tauri::command]
pub async fn repo_capture_start(window: tauri::WebviewWindow, app: tauri::AppHandle, display_id: String, consent: bool) -> Result<Lease, String> {
    trusted(&window)?;
    if !consent || display_id.is_empty() || display_id.len() > 20 || !display_id.bytes().all(|c| c.is_ascii_digit()) { return Err("Choose a display and explicitly approve screen observation".into()); }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let display = tauri::async_runtime::spawn_blocking(move || platform::select(&display_id)).await.map_err(|_| "Display selection stopped".to_string())??;
        let token = uuid::Uuid::new_v4().to_string();
        let session = Arc::new(Session { token: token.clone(), display: display.clone(), started: Instant::now(), stopped: AtomicBool::new(false), busy: AtomicBool::new(false), gate: Mutex::new(Gate::default()) });
        let state = app.state::<RepoCaptureState>();
        if let Some(old) = lock(&state.session).replace(session) { old.stopped.store(true, Ordering::Release); }
        return Ok(Lease { token, display, expires_after_ms: 3_600_000 });
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { let _ = (app, display_id); Err("Native repository capture supports macOS and Windows".into()) }
}
#[tauri::command]
pub fn repo_capture_stop(window: tauri::WebviewWindow, state: tauri::State<'_, RepoCaptureState>, token: String) -> Result<(), String> {
    trusted(&window)?;
    let mut slot = lock(&state.session);
    if slot.as_ref().map(|s| s.token == token).unwrap_or(false) {
        if let Some(session) = slot.take() { session.stopped.store(true, Ordering::Release); }
    }
    Ok(())
}
#[tauri::command]
pub async fn repo_capture_frame(window: tauri::WebviewWindow, state: tauri::State<'_, RepoCaptureState>, token: String, force: bool) -> Result<Option<Frame>, String> {
    trusted(&window)?;
    let session = lock(&state.session).as_ref().filter(|s| s.token == token).cloned().ok_or_else(|| "Capture lease ended; choose the display again".to_string())?;
    if session.stopped.load(Ordering::Acquire) || session.started.elapsed() >= Duration::from_secs(3600) { session.stopped.store(true, Ordering::Release); return Err("Capture lease expired".into()); }
    if session.busy.swap(true, Ordering::AcqRel) { return Ok(None); }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return tauri::async_runtime::spawn_blocking(move || {
        let _busy = Busy(&session.busy);
        if session.stopped.load(Ordering::Acquire) { return Ok(None); }
        let frame = platform::capture(&session, force)?;
        if session.stopped.load(Ordering::Acquire) { return Ok(None); }
        Ok(frame)
    }).await.map_err(|_| "Display capture worker stopped".to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { let _ = force; session.busy.store(false, Ordering::Release); Err("Native repository capture is unavailable".into()) }
}

// Pure frame gate: small changed regions matter, but frames must settle before
// extraction. Max sampling rate and min sent interval remain bounded even if the
// renderer invokes the command more frequently than advertised.
#[derive(Default)]
struct Gate { previous: Vec<u8>, accepted: Vec<u8>, changed_at: u64, last_sample: Option<u64>, last_sent: Option<u64> }
fn tile_difference(a: &[u8], b: &[u8]) -> f64 {
    if a.len() != b.len() || a.is_empty() { return 1.0; }
    a.chunks(64).zip(b.chunks(64)).map(|(x, y)| x.iter().zip(y).map(|(p, q)| f64::from(p.abs_diff(*q)) / 255.0).sum::<f64>() / x.len() as f64).fold(0.0, f64::max)
}
impl Gate {
    fn sample_allowed(&mut self, now: u64) -> bool {
        if self.last_sample.map(|t| now.saturating_sub(t) < 150).unwrap_or(false) { return false; }
        self.last_sample = Some(now); true
    }
    fn ready(&mut self, pixels: &[u8], now: u64, force: bool) -> bool {
        if self.previous.is_empty() || tile_difference(pixels, &self.previous) >= 0.025 { self.previous = pixels.to_vec(); self.changed_at = now; if !force { return false; } }
        if !force && (!self.accepted.is_empty() && tile_difference(pixels, &self.accepted) < 0.025 || now.saturating_sub(self.changed_at) < 400) { return false; }
        !self.last_sent.map(|t| now.saturating_sub(t) < 1400).unwrap_or(false)
    }
    fn accept(&mut self, pixels: Vec<u8>, now: u64) { self.accepted = pixels; self.last_sent = Some(now); }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod platform {
    use super::*;
    use image::{DynamicImage, codecs::jpeg::JpegEncoder, imageops::FilterType};
    fn fail(_: impl std::fmt::Display) -> String { "Could not capture the selected display. Check Screen Recording permission and reconnect the display.".into() }
    fn describe(m: &xcap::Monitor) -> Result<DisplayInfo, String> { Ok(DisplayInfo { id: m.id().map_err(fail)?.to_string(), name: m.friendly_name().or_else(|_| m.name()).map_err(fail)?, width: m.width().map_err(fail)?, height: m.height().map_err(fail)? }) }
    pub fn displays() -> Result<Vec<DisplayInfo>, String> { let _dpi = DpiScope::enter(); xcap::Monitor::all().map_err(fail)?.iter().map(describe).collect() }
    pub fn select(id: &str) -> Result<DisplayInfo, String> { request_permission()?; displays()?.into_iter().find(|d| d.id == id).ok_or_else(|| "Selected display disconnected".into()) }
    pub fn capture(session: &Session, force: bool) -> Result<Option<Frame>, String> {
        let now = session.started.elapsed().as_millis() as u64;
        if !lock(&session.gate).sample_allowed(now) { return Ok(None); }
        let _dpi = DpiScope::enter();
        let monitor = xcap::Monitor::all().map_err(fail)?.into_iter().find(|m| m.id().map(|id| id.to_string() == session.display.id).unwrap_or(false)).ok_or_else(|| "Selected display disconnected".to_string())?;
        let dimensions = describe(&monitor)?;
        if dimensions.width != session.display.width || dimensions.height != session.display.height { return Err("Display dimensions changed; choose the display again".into()); }
        let source = DynamicImage::ImageRgba8(monitor.capture_image().map_err(fail)?);
        let thumbnail = source.resize_exact(256, 144, FilterType::Triangle).to_luma8().into_raw();
        if !lock(&session.gate).ready(&thumbnail, now, force) { return Ok(None); }
        let image = source.resize(2400, 1600, FilterType::Triangle).to_rgb8();
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 92).encode_image(&image).map_err(fail)?;
        if bytes.len() > 2_000_000 { return Err("Frame exceeds 2 MB. Use a smaller display or upload a cropped screenshot.".into()); }
        if session.stopped.load(Ordering::Acquire) { return Ok(None); }
        lock(&session.gate).accept(thumbnail, now);
        Ok(Some(Frame { bytes, mime: "image/jpeg", width: image.width(), height: image.height() }))
    }
    #[cfg(target_os = "macos")]
    fn request_permission() -> Result<(), String> {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" { fn CGPreflightScreenCaptureAccess() -> bool; fn CGRequestScreenCaptureAccess() -> bool; }
        // SAFETY: documented zero-argument OS permission functions; only reached
        // after the user selected a display and pressed Start observation.
        if unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() } { Ok(()) } else { Err("Allow Screen Recording in System Settings, restart the app, then select the display again.".into()) }
    }
    #[cfg(target_os = "windows")]
    fn request_permission() -> Result<(), String> { Ok(()) }
    #[cfg(target_os = "windows")]
    struct DpiScope(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);
    #[cfg(target_os = "windows")]
    impl DpiScope { fn enter() -> Self { use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2}; Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }) } }
    #[cfg(target_os = "windows")]
    impl Drop for DpiScope { fn drop(&mut self) { if !self.0.0.is_null() { unsafe { windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(self.0); } } } }
    #[cfg(target_os = "macos")]
    struct DpiScope;
    #[cfg(target_os = "macos")]
    impl DpiScope { fn enter() -> Self { Self } }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unchanged_frames_never_repeat() { let mut g = Gate::default(); let p = vec![0; 256]; assert!(!g.ready(&p, 0, false)); assert!(g.ready(&p, 400, false)); g.accept(p.clone(), 400); assert!(!g.ready(&p, 10000, false)); }
    #[test]
    fn sampling_is_bounded() { let mut g = Gate::default(); assert!(g.sample_allowed(0)); assert!(!g.sample_allowed(100)); assert!(g.sample_allowed(200)); }
    #[test]
    fn changed_frames_settle_and_cool_down() { let mut g = Gate::default(); let a = vec![0; 256]; let b = vec![255; 256]; g.ready(&a, 0, false); g.accept(a, 400); assert!(!g.ready(&b, 500, false)); assert!(!g.ready(&b, 900, false)); assert!(g.ready(&b, 1800, false)); }
    #[test]
    fn forced_recapture_does_not_bypass_rate_limit() { let mut g = Gate::default(); let p = vec![0; 256]; assert!(g.ready(&p, 0, true)); g.accept(p.clone(), 0); assert!(!g.ready(&p, 100, true)); assert!(g.ready(&p, 1400, true)); }
    #[test]
    fn small_region_change_is_not_lost_in_fullscreen_average() { let a = vec![0; 256 * 144]; let mut b = a.clone(); b[..64].fill(255); assert_eq!(tile_difference(&a, &b), 1.0); }
}
