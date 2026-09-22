//! Platform objects never cross worker-thread boundaries. Frames are captured
//! on one worker; Enigo and all injected input live on a separate watchdog worker.
use enigo::{Axis, Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};
use remote_assist_core::{Display, InputEvent, MouseButton, MAX_FRAME_BYTES};
use std::collections::{HashMap, HashSet};

pub fn displays() -> Result<Vec<Display>, String> {
    let _dpi = DpiScope::enter();
    xcap::Monitor::all()
        .map_err(capture_error)?
        .iter()
        .map(describe)
        .collect()
}

fn capture_error(error: impl std::fmt::Display) -> String {
    format!("Could not capture the selected display: {error}. On macOS, allow Screen Recording in System Settings and restart the app if requested.")
}

fn describe(monitor: &xcap::Monitor) -> Result<Display, String> {
    let display = Display {
        id: monitor.id().map_err(capture_error)?.to_string(),
        name: monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .map_err(capture_error)?,
        x: monitor.x().map_err(capture_error)?,
        y: monitor.y().map_err(capture_error)?,
        width: monitor.width().map_err(capture_error)?,
        height: monitor.height().map_err(capture_error)?,
        scale_factor: monitor.scale_factor().map_err(capture_error)?,
        is_primary: monitor.is_primary().map_err(capture_error)?,
    };
    display.validate()?;
    Ok(display)
}

pub struct Capture {
    monitor: xcap::Monitor,
    display: Display,
    _dpi: DpiScope,
}

impl Capture {
    pub fn new(display_id: &str) -> Result<Self, String> {
        request_screen_permission()?;
        let dpi = DpiScope::enter();
        let monitor = xcap::Monitor::all()
            .map_err(capture_error)?
            .into_iter()
            .find(|m| {
                m.id()
                    .map(|id| id.to_string() == display_id)
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                "The selected display is no longer connected. Choose a display again.".to_string()
            })?;
        let display = describe(&monitor)?;
        Ok(Self {
            monitor,
            display,
            _dpi: dpi,
        })
    }

    pub fn display(&self) -> &Display {
        &self.display
    }

    pub fn frame(&self) -> Result<Vec<u8>, String> {
        let current = describe(&self.monitor)?;
        if current.x != self.display.x
            || current.y != self.display.y
            || current.width != self.display.width
            || current.height != self.display.height
            || current.scale_factor != self.display.scale_factor
        {
            return Err("Display layout changed. Restart sharing to confirm the display and pointer coordinates.".into());
        }
        let captured = self.monitor.capture_image().map_err(capture_error)?;
        let source = DynamicImage::ImageRgba8(captured);
        // JPEGs at <=1280x900 / 5 fps are sufficient for text navigation without
        // unbounded IPC/WebRTC buffers. This is deliberately not a 60fps codec.
        let small = source.resize(1280, 900, FilterType::Triangle).to_rgb8();
        for quality in [65, 45, 25] {
            let mut encoded = Vec::new();
            JpegEncoder::new_with_quality(&mut encoded, quality)
                .encode_image(&small)
                .map_err(|e| format!("Could not encode display frame: {e}"))?;
            if encoded.len() <= MAX_FRAME_BYTES {
                return Ok(encoded);
            }
        }
        Err("The display frame exceeded the remote assistance size limit.".into())
    }
}

#[cfg(target_os = "macos")]
fn request_screen_permission() -> Result<(), String> {
    // Unlike the audio primer, remote video requires Screen Recording on macOS
    // 15 too. Only called after a host explicitly starts sharing a display.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    // SAFETY: documented zero-argument CoreGraphics permission APIs on macOS13+.
    if unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() } {
        Ok(())
    } else {
        Err("Allow Screen Recording for this app in System Settings > Privacy & Security, then restart the app and start sharing again.".into())
    }
}

#[cfg(target_os = "windows")]
fn request_screen_permission() -> Result<(), String> {
    Ok(())
}

pub struct Input {
    enigo: Enigo,
    held_keys: HashMap<String, Key>,
    held_buttons: HashSet<MouseButton>,
    _dpi: DpiScope,
}

impl Input {
    pub fn new() -> Result<Self, String> {
        let dpi = DpiScope::enter();
        let settings = Settings {
            release_keys_when_dropped: true,
            open_prompt_to_get_permissions: true,
            ..Settings::default()
        };
        let enigo = Enigo::new(&settings).map_err(|e| format!("Remote control could not start: {e}. On macOS, allow Accessibility access for this app in System Settings, then enable control again."))?;
        Ok(Self {
            enigo,
            held_keys: HashMap::new(),
            held_buttons: HashSet::new(),
            _dpi: dpi,
        })
    }

    pub fn ensure_permission(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            #[link(name = "ApplicationServices", kind = "framework")]
            extern "C" {
                fn AXIsProcessTrusted() -> bool;
            }
            // SAFETY: documented zero-argument Accessibility preflight. The
            // initial Enigo::new call owns prompting; a revoked grant is an error.
            if !unsafe { AXIsProcessTrusted() } {
                return Err("Allow Accessibility for this app in System Settings before enabling remote control.".into());
            }
        }
        Ok(())
    }

    pub fn release_held(&mut self) -> Result<(), String> {
        let mut first_error = None;
        for button in self.held_buttons.clone() {
            match self.enigo.button(native_button(button), Direction::Release) {
                Ok(()) => {
                    self.held_buttons.remove(&button);
                }
                Err(error) => {
                    first_error.get_or_insert_with(|| input_error(error));
                }
            }
        }
        for (name, key) in self.held_keys.clone() {
            match self.enigo.key(key, Direction::Release) {
                Ok(()) => {
                    self.held_keys.remove(&name);
                }
                Err(error) => {
                    first_error.get_or_insert_with(|| input_error(error));
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    pub fn apply(&mut self, event: &InputEvent, display: &Display) -> Result<(), String> {
        match event {
            InputEvent::Move { x, y, .. } => {
                let (x, y) = display.point(*x, *y)?;
                self.move_pointer(x, y)?;
            }
            InputEvent::Button { button, down, .. } => {
                // Repeated downs must not create unmatched held-button state.
                if *down {
                    if !self.held_buttons.contains(button) {
                        self.enigo
                            .button(native_button(*button), Direction::Press)
                            .map_err(input_error)?;
                        self.held_buttons.insert(*button);
                    }
                } else if self.held_buttons.contains(button) {
                    self.enigo
                        .button(native_button(*button), Direction::Release)
                        .map_err(input_error)?;
                    self.held_buttons.remove(button);
                }
            }
            InputEvent::Key { key, down, .. } => {
                if *down {
                    let native = native_key(key)?;
                    if !self.held_keys.contains_key(key) {
                        if self.held_keys.len() >= 32 {
                            return Err("Too many remote keys are held at once.".into());
                        }
                        self.enigo
                            .key(native, Direction::Press)
                            .map_err(input_error)?;
                        self.held_keys.insert(key.clone(), native);
                    }
                } else if let Some(native) = self.held_keys.get(key).copied() {
                    self.enigo
                        .key(native, Direction::Release)
                        .map_err(input_error)?;
                    self.held_keys.remove(key);
                }
            }
            InputEvent::Scroll {
                delta_x, delta_y, ..
            } => {
                if *delta_x != 0 {
                    self.enigo
                        .scroll(*delta_x, Axis::Horizontal)
                        .map_err(input_error)?;
                }
                if *delta_y != 0 {
                    self.enigo
                        .scroll(*delta_y, Axis::Vertical)
                        .map_err(input_error)?;
                }
            }
            InputEvent::Text { text, .. } => self.enigo.text(text).map_err(input_error)?,
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn move_pointer(&mut self, x: i32, y: i32) -> Result<(), String> {
        // CoreGraphics/XCap monitor bounds and Enigo use the same logical
        // coordinate system, including negative monitor origins on Retina Macs.
        self.enigo
            .move_mouse(x, y, enigo::Coordinate::Abs)
            .map_err(input_error)
    }

    #[cfg(target_os = "windows")]
    fn move_pointer(&mut self, x: i32, y: i32) -> Result<(), String> {
        use windows::Win32::UI::{
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_MOVE,
                MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT,
            },
            WindowsAndMessaging::{
                GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
                SM_YVIRTUALSCREEN,
            },
        };
        // Enigo 0.6.1 normalizes absolute moves against the primary display.
        // Native VIRTUALDESK input is required for left/above and mixed-DPI
        // displays. All dimensions here are physical pixels under DpiScope.
        // SAFETY: GetSystemMetrics has no pointer arguments or preconditions.
        let (left, top, width, height) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };
        if width <= 1 || height <= 1 {
            return Err("Windows virtual desktop is unavailable.".into());
        }
        let dx = ((i64::from(x) - i64::from(left)) * 65_535 / i64::from(width - 1)).clamp(0, 65_535)
            as i32;
        let dy = ((i64::from(y) - i64::from(top)) * 65_535 / i64::from(height - 1)).clamp(0, 65_535)
            as i32;
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    time: 0,
                    dwExtraInfo: enigo::EVENT_MARKER as usize,
                },
            },
        };
        // SAFETY: initialized INPUT and correct structure size; Windows copies
        // the slice during this call. No remote pointers cross this boundary.
        if unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) } == 1 {
            Ok(())
        } else {
            Err("Windows could not move the pointer. Elevated apps and secure desktops cannot be controlled from this app.".into())
        }
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        // Enigo releases keys on drop, but NOT mouse buttons. Explicitly release
        // both, including when control is revoked or the worker unwinds.
        let _ = self.release_held();
    }
}

fn input_error(error: impl std::fmt::Display) -> String {
    format!("Remote input failed: {error}")
}
fn native_button(button: MouseButton) -> Button {
    match button {
        MouseButton::Left => Button::Left,
        MouseButton::Middle => Button::Middle,
        MouseButton::Right => Button::Right,
    }
}

fn native_key(key: &str) -> Result<Key, String> {
    let named = match key {
        "Enter" => Key::Return,
        "Tab" => Key::Tab,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "Escape" => Key::Escape,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        #[cfg(target_os = "windows")]
        "Insert" => Key::Insert,
        #[cfg(target_os = "macos")]
        "Insert" => return Err("Insert is not available on the macOS keyboard adapter.".into()),
        "Shift" => Key::Shift,
        "Control" => Key::Control,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        "CapsLock" => Key::CapsLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        _ => {
            let mut chars = key.chars();
            match (chars.next(), chars.next()) {
                (Some(ch), None) if !ch.is_control() => Key::Unicode(ch),
                _ => return Err("Unsupported keyboard key.".into()),
            }
        }
    };
    Ok(named)
}

/// Scope DPI awareness to our worker thread; never change Tauri's global DPI
/// context after its window already exists. Restored when the worker exits.
#[cfg(target_os = "windows")]
struct DpiScope(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);
#[cfg(target_os = "windows")]
impl DpiScope {
    fn enter() -> Self {
        use windows::Win32::UI::HiDpi::{
            SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        // SAFETY: documented per-thread context API, supported since Windows10.
        Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) })
    }
}
#[cfg(target_os = "windows")]
impl Drop for DpiScope {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            // SAFETY: restore the context returned on this same worker thread.
            unsafe {
                windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(self.0);
            }
        }
    }
}
#[cfg(target_os = "macos")]
struct DpiScope;
#[cfg(target_os = "macos")]
impl DpiScope {
    fn enter() -> Self {
        Self
    }
}
