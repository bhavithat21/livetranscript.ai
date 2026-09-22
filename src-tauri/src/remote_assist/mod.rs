//! Owner-approved, short-lived native screen sharing and input. The web host
//! validates the approved peer and forwards input; this layer separately limits
//! the lease, selected display, replayed sequences, input rate, and payload size.
use remote_assist_core::{Display, InputEvent, LeasePolicy, LEASE_MS, MAX_FRAME_BYTES};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    Emitter, Manager,
};

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod platform;

#[derive(Default)]
pub struct RemoteAssistState {
    session: Mutex<Option<Arc<Session>>>,
    shortcut_registered: AtomicBool,
    tray_registered: AtomicBool,
}

struct Session {
    id: String,
    created: Instant,
    policy: Mutex<LeasePolicy>,
    stop_reason: Mutex<String>,
    stopped: AtomicBool,
    finished: AtomicBool,
    capture_finished: AtomicBool,
    control_epoch: AtomicU64,
    commands: SyncSender<Command>,
}

impl Session {
    fn now(&self) -> u64 {
        self.created.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
    }
    fn live(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("Remote assistance has stopped.".into());
        }
        crate::lock(&self.policy).check_live(self.now())
    }
    fn stop(&self, reason: impl Into<String>) {
        // First stop reason wins; later heartbeats/commands cannot revive it.
        if !self.stopped.swap(true, Ordering::AcqRel) {
            *crate::lock(&self.stop_reason) = reason.into();
            crate::lock(&self.policy).stop();
        }
    }
}

type Reply = SyncSender<Result<(), String>>;
enum Command {
    Control(bool, u64, Reply),
    Input(InputEvent, Reply),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    supported: bool,
    protocol_version: u8,
    platform: &'static str,
    stop_shortcut: &'static str,
    stop_shortcut_registered: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    lease_id: String,
    display: Display,
    heartbeat_ms: u64,
    expires_after_ms: u64,
    max_frame_bytes: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Stopped {
    lease_id: String,
    reason: String,
}

/// Custom commands are additionally restricted to the app's primary trusted
/// webview. Tauri capabilities already restrict remote origins; keep the check
/// here so an accidentally broadened capability cannot authorize another view.
fn trusted_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "Could not verify the host window.".to_string())?;
    let trusted = url.scheme() == "https"
        && url.host_str() == Some("livetranscript.ai")
        && url.port_or_known_default() == Some(443);
    #[cfg(debug_assertions)]
    let trusted = trusted
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")));
    if window.label() != "main" || !trusted {
        return Err(
            "Remote assistance is available only in the trusted desktop host window.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn remote_assist_capabilities(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RemoteAssistState>,
) -> Result<Capabilities, String> {
    trusted_window(&window)?;
    Ok(Capabilities {
        supported: cfg!(any(target_os = "macos", target_os = "windows")),
        protocol_version: 1,
        platform: std::env::consts::OS,
        stop_shortcut: if cfg!(target_os = "macos") {
            "Cmd+Option+Shift+X"
        } else {
            "Ctrl+Alt+Shift+X"
        },
        stop_shortcut_registered: state.shortcut_registered.load(Ordering::Acquire),
    })
}

#[tauri::command]
pub async fn remote_assist_displays(window: tauri::WebviewWindow) -> Result<Vec<Display>, String> {
    trusted_window(&window)?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return tauri::async_runtime::spawn_blocking(platform::displays)
        .await
        .map_err(|_| "Display discovery could not complete.".to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("Native remote assistance currently supports macOS and Windows.".into())
}

#[tauri::command]
pub async fn remote_assist_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RemoteAssistState>,
    display_id: String,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<Started, String> {
    trusted_window(&window)?;
    if !state.shortcut_registered.load(Ordering::Acquire)
        && !state.tray_registered.load(Ordering::Acquire)
    {
        return Err("Remote assistance cannot start because neither its emergency shortcut nor tray stop is available. Restart the desktop app and try again.".into());
    }
    if display_id.is_empty()
        || display_id.len() > 20
        || !display_id.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("Choose a connected display before starting remote assistance.".into());
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let (commands, receiver) = mpsc::sync_channel(64);
        let session = Arc::new(Session {
            id: uuid::Uuid::new_v4().to_string(),
            created: Instant::now(),
            policy: Mutex::new(LeasePolicy::default()),
            stop_reason: Mutex::new("Remote assistance stopped.".into()),
            stopped: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            capture_finished: AtomicBool::new(false),
            control_epoch: AtomicU64::new(0),
            commands,
        });
        {
            let mut slot = crate::lock(&state.session);
            if let Some(previous) = slot.as_ref() {
                if !previous.finished.load(Ordering::Acquire)
                    || !previous.capture_finished.load(Ordering::Acquire)
                {
                    return Err("A remote assistance session is active or still stopping. Stop it before starting another.".into());
                }
            }
            *slot = Some(session.clone());
        }
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let capture_session = session.clone();
        let capture = std::thread::Builder::new()
            .name("remote-display".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    capture_worker(capture_session.clone(), display_id, on_frame, ready_tx)
                }));
                if result.is_err() {
                    capture_session.stop("Screen capture stopped unexpectedly.");
                }
                capture_session
                    .capture_finished
                    .store(true, Ordering::Release);
            });
        if capture.is_err() {
            session.stop("Could not start the screen capture worker.");
            session.finished.store(true, Ordering::Release);
            session.capture_finished.store(true, Ordering::Release);
            return Err("Could not start screen capture.".into());
        }
        // Capture passes its verified display bounds to the input worker. There
        // is no input authority until this succeeds and the host enables it.
        let startup = tauri::async_runtime::spawn_blocking(move || {
            ready_rx.recv_timeout(Duration::from_secs(4))
        })
        .await
        .map_err(|_| "Screen capture startup was interrupted.".to_string());
        let display = match startup {
            Ok(Ok(Ok(display))) => display,
            Ok(Ok(Err(error))) => {
                session.stop(error.clone());
                session.finished.store(true, Ordering::Release);
                emit_stopped(&app, &session);
                return Err(error);
            }
            _ => {
                session.stop("Screen capture did not start within four seconds. Check Screen Recording permissions and try again.");
                session.finished.store(true, Ordering::Release);
                emit_stopped(&app, &session);
                return Err(
                    "Screen capture timed out. Check Screen Recording permissions and try again."
                        .into(),
                );
            }
        };
        if let Err(error) = session.live() {
            session.stop(error.clone());
            session.finished.store(true, Ordering::Release);
            emit_stopped(&app, &session);
            return Err(error);
        }
        let worker_session = session.clone();
        let worker_app = app.clone();
        let worker_display = display.clone();
        if std::thread::Builder::new()
            .name("remote-input-watchdog".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    input_worker(&worker_session, &worker_display, receiver)
                }));
                let mut retired_input = match result {
                    Ok(input) => input,
                    Err(_) => {
                        worker_session.stop("Remote input stopped unexpectedly.");
                        None
                    }
                };
                let released = retired_input
                    .as_mut()
                    .map(|input| input.release_held())
                    .unwrap_or(Ok(()));
                if released.is_ok() {
                    // Enigo 0.6.1 on macOS sleeps in its destructor after it has
                    // released its keys. All remote inputs are already released
                    // here: acknowledge stop before that trailing library sleep.
                    std::thread::sleep(Duration::from_millis(25));
                    worker_session.finished.store(true, Ordering::Release);
                    emit_stopped(&worker_app, &worker_session);
                    drop(retired_input);
                } else {
                    // Do not permit a new lease until the destructor's retry has
                    // finished if the OS rejected a release operation.
                    emit_stopped(&worker_app, &worker_session);
                    drop(retired_input);
                    worker_session.finished.store(true, Ordering::Release);
                }
            })
            .is_err()
        {
            session.stop("Could not start the remote assistance watchdog.");
            session.finished.store(true, Ordering::Release);
            emit_stopped(&app, &session);
            return Err("Could not start the remote assistance watchdog.".into());
        }
        Ok(Started {
            lease_id: session.id.clone(),
            display,
            heartbeat_ms: 1_000,
            expires_after_ms: LEASE_MS,
            max_frame_bytes: MAX_FRAME_BYTES,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, state, display_id, on_frame);
        Err("Native remote assistance currently supports macOS and Windows.".into())
    }
}

fn find_session(state: &RemoteAssistState, lease_id: &str) -> Result<Arc<Session>, String> {
    let session = crate::lock(&state.session)
        .as_ref()
        .filter(|s| s.id == lease_id)
        .cloned()
        .ok_or_else(|| "This remote assistance session is no longer active.".to_string())?;
    session.live()?;
    Ok(session)
}

#[tauri::command]
pub fn remote_assist_heartbeat(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RemoteAssistState>,
    lease_id: String,
) -> Result<(), String> {
    trusted_window(&window)?;
    let session = find_session(&state, &lease_id)?;
    let result = crate::lock(&session.policy).heartbeat(session.now());
    if let Err(error) = &result {
        session.stop(error.clone());
    }
    result
}

async fn request(
    session: Arc<Session>,
    command: impl FnOnce(Reply) -> Command,
) -> Result<(), String> {
    let (reply, receive) = mpsc::sync_channel(1);
    session
        .commands
        .try_send(command(reply))
        .map_err(|_| "The remote input queue is busy or disconnected.".to_string())?;
    let response =
        tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(Duration::from_secs(2)))
            .await
            .map_err(|_| "Remote input was interrupted.".to_string())?;
    match response {
        Ok(value) => value,
        Err(_) => {
            session.stop("Remote input timed out; assistance has stopped.");
            Err("Remote input timed out; assistance has stopped.".into())
        }
    }
}

#[tauri::command]
pub async fn remote_assist_set_control(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RemoteAssistState>,
    lease_id: String,
    enabled: bool,
) -> Result<(), String> {
    trusted_window(&window)?;
    let session = find_session(&state, &lease_id)?;
    // Revoke immediately, even before the worker reaches queued input. Its next
    // check will reject queued events and it releases all held inputs below.
    let epoch = session.control_epoch.fetch_add(1, Ordering::AcqRel) + 1;
    if !enabled {
        crate::lock(&session.policy).set_control(false, session.now())?;
    }
    request(session, |reply| Command::Control(enabled, epoch, reply)).await
}

#[tauri::command]
pub async fn remote_assist_input(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RemoteAssistState>,
    lease_id: String,
    event: InputEvent,
) -> Result<(), String> {
    trusted_window(&window)?;
    let session = find_session(&state, &lease_id)?;
    request(session, |reply| Command::Input(event, reply)).await
}

#[tauri::command]
pub fn remote_assist_stop(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RemoteAssistState>,
    lease_id: String,
) -> Result<(), String> {
    trusted_window(&window)?;
    if let Some(session) = crate::lock(&state.session)
        .as_ref()
        .filter(|s| s.id == lease_id)
    {
        session.stop("Stopped on the host laptop.");
    }
    Ok(())
}

pub fn stop_all(app: &tauri::AppHandle, reason: &str) {
    let state = app.state::<RemoteAssistState>();
    let session = crate::lock(&state.session).clone();
    if let Some(session) = session {
        session.stop(reason);
    }
}

pub fn set_shortcut_registered(app: &tauri::AppHandle, registered: bool) {
    app.state::<RemoteAssistState>()
        .shortcut_registered
        .store(registered, Ordering::Release);
}

pub fn set_tray_registered(app: &tauri::AppHandle) {
    app.state::<RemoteAssistState>()
        .tray_registered
        .store(true, Ordering::Release);
}

/// Let teardown release held keys before process exit; never wait indefinitely.
pub fn stop_for_exit(app: &tauri::AppHandle) {
    let session = crate::lock(&app.state::<RemoteAssistState>().session).clone();
    if let Some(session) = session {
        session.stop("The desktop app is closing.");
        let deadline = Instant::now() + Duration::from_millis(500);
        while !session.finished.load(Ordering::Acquire) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

fn emit_stopped(app: &tauri::AppHandle, session: &Session) {
    let _ = app.emit_to(
        "main",
        "remote-assist-stopped",
        Stopped {
            lease_id: session.id.clone(),
            reason: crate::lock(&session.stop_reason).clone(),
        },
    );
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn capture_worker(
    session: Arc<Session>,
    display_id: String,
    on_frame: Channel<InvokeResponseBody>,
    ready: SyncSender<Result<Display, String>>,
) {
    let capture = match platform::Capture::new(&display_id) {
        Ok(capture) => capture,
        Err(error) => {
            session.stop(error.clone());
            let _ = ready.send(Err(error));
            return;
        }
    };
    let first = match capture.frame() {
        Ok(frame) => frame,
        Err(error) => {
            session.stop(error.clone());
            let _ = ready.send(Err(error));
            return;
        }
    };
    if session.live().is_err() {
        return;
    }
    if ready.send(Ok(capture.display().clone())).is_err() {
        session.stop("The host closed while screen sharing started.");
        return;
    }
    let mut frame = first;
    loop {
        if let Err(reason) = session.live() {
            session.stop(reason);
            break;
        }
        if on_frame.send(InvokeResponseBody::Raw(frame)).is_err() {
            session.stop("The host screen-sharing connection closed.");
            break;
        }
        // 5fps maximum; chunking/backpressure on the WebRTC channel is applied
        // by the host bridge. No screenshots are written to disk.
        std::thread::sleep(Duration::from_millis(200));
        if let Err(reason) = session.live() {
            session.stop(reason);
            break;
        }
        frame = match capture.frame() {
            Ok(frame) => frame,
            Err(reason) => {
                session.stop(reason);
                break;
            }
        };
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn input_worker(
    session: &Session,
    display: &Display,
    receiver: Receiver<Command>,
) -> Option<platform::Input> {
    let mut input: Option<platform::Input> = None;
    loop {
        if let Err(reason) = session.live() {
            session.stop(reason);
            break;
        }
        // Revocation releases held input even if the bounded command queue was
        // full when its acknowledgement was requested. Never leave a drag or
        // modifier held merely because a helper flooded pointer events.
        if !crate::lock(&session.policy).control_enabled() {
            if let Some(adapter) = input.as_mut() {
                if let Err(error) = adapter.release_held() {
                    session.stop(error);
                    break;
                }
            }
        }
        let command = match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(command) => command,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => {
                session.stop("The host input connection closed.");
                break;
            }
        };
        match command {
            Command::Control(enabled, epoch, reply) => {
                let result = (|| {
                    session.live()?;
                    if epoch != session.control_epoch.load(Ordering::Acquire) {
                        return Err("A newer control preference replaced this request.".into());
                    }
                    if enabled {
                        if input.is_none() {
                            input = Some(platform::Input::new()?);
                        }
                        if let Some(adapter) = input.as_ref() {
                            adapter.ensure_permission()?;
                        }
                        session.live()?;
                        if epoch != session.control_epoch.load(Ordering::Acquire) {
                            if let Some(adapter) = input.as_mut() {
                                adapter.release_held()?;
                            }
                            return Err(
                                "Control was changed while its permission request was pending."
                                    .into(),
                            );
                        }
                    } else {
                        if let Some(adapter) = input.as_mut() {
                            adapter.release_held()?;
                        }
                    }
                    let mut policy = crate::lock(&session.policy);
                    if epoch != session.control_epoch.load(Ordering::Acquire) {
                        return Err("A newer control preference replaced this request.".into());
                    }
                    policy.set_control(enabled, session.now())
                })();
                let _ = reply.send(result);
            }
            Command::Input(event, reply) => {
                let result = {
                    // Serialize revocation with the operation it authorizes.
                    // A stop also flips the independent atomic flag immediately,
                    // so queued input cannot run while teardown awaits this lock.
                    let mut policy = crate::lock(&session.policy);
                    policy.accept(&event, display, session.now()).and_then(|_| {
                        if session.stopped.load(Ordering::Acquire) {
                            return Err("Remote assistance has stopped.".into());
                        }
                        input
                            .as_mut()
                            .ok_or_else(|| "Remote control is disabled.".to_string())?
                            .apply(&event, display)
                    })
                };
                if let Err(error) = &result {
                    // Invalid packets do not gain authority. An actual platform
                    // injection failure ends the session and releases held input.
                    if error.starts_with("Remote input failed:")
                        || error.starts_with("Windows could not")
                    {
                        session.stop(error.clone());
                    }
                }
                let _ = reply.send(result);
            }
        }
    }
    input // caller releases keys/buttons before acknowledging stop.
}
