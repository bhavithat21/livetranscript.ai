//! Read-only, owner-selected screen evidence for repository coaching.
//! No input injection, filesystem access or external process execution.
use serde::Serialize;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewWindow};

const LEASE: Duration = Duration::from_secs(90 * 60);
#[derive(Clone)]
struct Session { id: String, display: String, created: Instant, in_flight: Arc<AtomicBool> }
#[derive(Default)]
pub struct CoachCaptureState { session: Mutex<Option<Session>> }
#[derive(Serialize)]
pub struct Display { id: String, name: String, width: u32, height: u32 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started { lease_id: String }
#[derive(Serialize)]
pub struct Sample { width: u32, height: u32, pixels: Vec<u8> }

pub(crate) fn trusted(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "Cannot verify desktop origin")?;
    let approved = url.scheme() == "https" && url.host_str() == Some("livetranscript.ai") && url.port_or_known_default() == Some(443);
    #[cfg(debug_assertions)]
    let approved = approved || (url.scheme() == "http" && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")));
    if window.label() != "main" || !approved { return Err("Capture is restricted to the trusted desktop window".into()); }
    Ok(())
}
fn session(state: &CoachCaptureState, id: &str) -> Result<Session, String> {
    let guard = crate::lock(&state.session);
    let active = guard.as_ref().filter(|s| s.id == id && s.created.elapsed() < LEASE).ok_or("Screen session ended or expired. Select the display again.")?;
    Ok(active.clone())
}
struct Permit(Arc<AtomicBool>);
impl Drop for Permit { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }
fn acquire(s: &Session) -> Result<Permit, String> {
    if s.in_flight.swap(true, Ordering::AcqRel) { return Err("A screen sample is already in progress".into()); }
    Ok(Permit(s.in_flight.clone()))
}
pub fn stop_all(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<CoachCaptureState>() { crate::lock(&state.session).take(); }
}
#[tauri::command]
pub async fn coach_displays(window: WebviewWindow) -> Result<Vec<Display>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(platform_displays).await.map_err(|_| "Display discovery worker failed".to_string())?
}
#[tauri::command]
pub async fn coach_start(window: WebviewWindow, state: tauri::State<'_, CoachCaptureState>, display_id: String, approved: bool) -> Result<Started, String> {
    trusted(&window)?;
    if !approved || display_id.len() > 40 || display_id.is_empty() { return Err("Select a display and explicitly approve capture".into()); }
    if !window.is_visible().unwrap_or(false) { return Err("Show the desktop window before approving screen capture".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let next = Session { id: id.clone(), display: display_id.clone(), created: Instant::now(), in_flight: Arc::new(AtomicBool::new(false)) };
    // A stop or newer start during asynchronous OS permission work invalidates this request.
    *crate::lock(&state.session) = Some(next);
    let result = tauri::async_runtime::spawn_blocking(move || {
        request_permission()?;
        if !platform_displays()?.iter().any(|d| d.id == display_id) { return Err("Selected display is no longer connected".into()); }
        Ok::<(), String>(())
    }).await.unwrap_or_else(|_| Err("Screen permission worker failed".to_string()));
    if result.is_err() {
        let mut guard = crate::lock(&state.session);
        if guard.as_ref().is_some_and(|s| s.id == id) { guard.take(); }
        return Err("Screen permission or display validation failed. Check OS Screen Recording permissions.".into());
    }
    session(&state, &id)?;
    Ok(Started { lease_id: id })
}
#[tauri::command]
pub fn coach_stop(window: WebviewWindow, state: tauri::State<'_, CoachCaptureState>, lease_id: String) -> Result<(), String> {
    trusted(&window)?;
    let mut guard = crate::lock(&state.session);
    if guard.as_ref().is_some_and(|s| s.id == lease_id) { guard.take(); }
    Ok(())
}
#[tauri::command]
pub async fn coach_sample(window: WebviewWindow, state: tauri::State<'_, CoachCaptureState>, lease_id: String) -> Result<Sample, String> {
    trusted(&window)?;
    let selected = session(&state, &lease_id)?;
    let permit = acquire(&selected)?;
    let display = selected.display.clone();
    let sample = tauri::async_runtime::spawn_blocking(move || { let _permit = permit; platform_sample(&display) }).await.map_err(|_| "Screen sample worker failed".to_string())??;
    session(&state, &lease_id)?;
    Ok(sample)
}
#[tauri::command]
pub async fn coach_grab(window: WebviewWindow, state: tauri::State<'_, CoachCaptureState>, lease_id: String) -> Result<tauri::ipc::Response, String> {
    trusted(&window)?;
    let selected = session(&state, &lease_id)?;
    let permit = acquire(&selected)?;
    let display = selected.display.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || { let _permit = permit; platform_image(&display) }).await.map_err(|_| "Screen image worker failed".to_string())??;
    session(&state, &lease_id)?;
    Ok(tauri::ipc::Response::new(bytes))
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn platform_displays() -> Result<Vec<Display>, String> {
    xcap::Monitor::all().map_err(|_| "Display discovery failed".to_string())?.iter().map(|m| {
        Ok(Display { id: m.id().map_err(|_| "Display id unavailable")?.to_string(), name: m.friendly_name().or_else(|_| m.name()).map_err(|_| "Display name unavailable")?, width: m.width().map_err(|_| "Display size unavailable")?, height: m.height().map_err(|_| "Display size unavailable")? })
    }).collect()
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn pixels(display: &str) -> Result<image::DynamicImage, String> {
    let monitor = xcap::Monitor::all().map_err(|_| "Display discovery failed")?.into_iter().find(|m| m.id().map(|id| id.to_string() == display).unwrap_or(false)).ok_or("Selected display disconnected")?;
    let image = monitor.capture_image().map_err(|_| "Screen capture failed; check Screen Recording permission")?;
    if image.width() > 16384 || image.height() > 16384 || u64::from(image.width()) * u64::from(image.height()) > 50_000_000 { return Err("Display exceeds the capture size limit".into()); }
    Ok(image::DynamicImage::ImageRgba8(image))
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn platform_sample(display: &str) -> Result<Sample, String> {
    let gray = pixels(display)?.resize(640, 640, image::imageops::FilterType::Triangle).to_luma8();
    Ok(Sample { width: gray.width(), height: gray.height(), pixels: gray.into_raw().into_iter().map(|p| (p / 8) * 8).collect() })
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn platform_image(display: &str) -> Result<Vec<u8>, String> {
    let image = pixels(display)?.resize(2400, 2400, image::imageops::FilterType::Triangle).to_rgb8();
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 94).encode_image(&image).map_err(|_| "Screenshot encoding failed")?;
    if output.len() > 4_400_000 { return Err("Screenshot too large; select a smaller display or browser window".into()); }
    Ok(output)
}
#[cfg(target_os = "macos")]
pub(crate) fn request_permission() -> Result<(), String> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" { fn CGPreflightScreenCaptureAccess() -> bool; fn CGRequestScreenCaptureAccess() -> bool; }
    // SAFETY: stable zero-argument macOS Screen Recording permission APIs.
    if unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() } { Ok(()) } else { Err("Allow Screen Recording in System Settings before sharing".into()) }
}
#[cfg(target_os = "windows")]
pub(crate) fn request_permission() -> Result<(), String> { Ok(()) }
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn request_permission() -> Result<(), String> { Err("Native screen evidence is supported on macOS and Windows".into()) }
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_displays() -> Result<Vec<Display>, String> { Err("Native screen evidence is unsupported on this platform".into()) }
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_sample(_: &str) -> Result<Sample, String> { Err("Native screen evidence is unsupported on this platform".into()) }
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_image(_: &str) -> Result<Vec<u8>, String> { Err("Native screen evidence is unsupported on this platform".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn seeded() -> CoachCaptureState { CoachCaptureState { session: Mutex::new(Some(Session { id: "fixture".into(), display: "1".into(), created: Instant::now(), in_flight: Arc::new(AtomicBool::new(false)) })) } }
    #[test] fn rejects_wrong_lease() { assert!(session(&seeded(), "other").is_err()); }
    #[test] fn stop_cannot_revive_session() { let state = seeded(); crate::lock(&state.session).take(); assert!(session(&state, "fixture").is_err()); }
    #[test] fn bounds_concurrent_capture() { let s = session(&seeded(), "fixture").unwrap(); let p = acquire(&s).unwrap(); assert!(acquire(&s).is_err()); drop(p); assert!(acquire(&s).is_ok()); }
    #[test] fn rejects_expired_lease() { let state = seeded(); crate::lock(&state.session).as_mut().unwrap().created = Instant::now() - LEASE; assert!(session(&state, "fixture").is_err()); }
}
