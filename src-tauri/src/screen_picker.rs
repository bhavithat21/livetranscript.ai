//! Session-scoped ScreenCaptureKit picker in the bundled macOS helper.
//! Frames stay in memory; the frontend explicitly requests any image sent to AI.
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri_plugin_shell::{ShellExt, process::{CommandChild, CommandEvent}};

pub struct PickerCapture {
    child: Mutex<Option<CommandChild>>,
    frame: Arc<Mutex<Result<Option<Vec<u8>>, String>>>,
    stopped: AtomicBool,
}
impl PickerCapture {
    pub fn start(app: &tauri::AppHandle) -> Result<Arc<Self>, String> {
        let (mut events, child) = app.shell().sidecar("audio-capture")
            .map_err(|_| "Install the current desktop app to enable the system screen picker.")?
            .args(["--screen"]).set_raw_out(true).spawn()
            .map_err(|_| "The system screen picker could not start. Reopen LiveTranscript.")?;
        let frame = Arc::new(Mutex::new(Ok(None)));
        let capture = Arc::new(Self { child: Mutex::new(Some(child)), frame: frame.clone(), stopped: AtomicBool::new(false) });
        tauri::async_runtime::spawn(async move {
            let mut buffer = Vec::<u8>::new();
            let mut reason = "Screen selection was cancelled or sharing ended. Select a window or display again.".to_string();
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        match decode_frames(&mut buffer, &bytes) {
                            Ok(Some(jpeg)) => *crate::lock(&frame) = Ok(Some(jpeg)),
                            Ok(None) => {},
                            Err(error) => { *crate::lock(&frame) = Err(error); return; }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let text = String::from_utf8_lossy(&bytes);
                        if text.starts_with("Screen ") { reason = text.trim().chars().take(500).collect(); }
                    }
                    CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
                    _ => {}
                }
            }
            *crate::lock(&frame) = Err(reason);
        });
        Ok(capture)
    }
    pub fn wait_ready(&self) -> Result<(), String> {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(90) {
            if self.stopped.load(Ordering::Acquire) { return Err("Screen sharing was stopped.".into()); }
            match &*crate::lock(&self.frame) { Ok(Some(_)) => return Ok(()), Err(error) => return Err(error.clone()), _ => {} }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.stop();
        Err("No screen was selected. Click Enable screen sharing and select a window or display in the macOS picker.".into())
    }
    pub fn image(&self) -> Result<Vec<u8>, String> {
        if self.stopped.load(Ordering::Acquire) { return Err("Screen sharing was stopped.".into()); }
        crate::lock(&self.frame).clone()?.ok_or_else(|| "Waiting for the selected screen.".into())
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Some(child) = crate::lock(&self.child).take() { let _ = child.kill(); }
        *crate::lock(&self.frame) = Err("Screen sharing was stopped.".into());
    }
}
impl Drop for PickerCapture { fn drop(&mut self) { self.stop(); } }

// A raw pipe read need not coincide with a frame boundary.
fn decode_frames(buffer: &mut Vec<u8>, bytes: &[u8]) -> Result<Option<Vec<u8>>, String> {
    buffer.extend_from_slice(bytes);
    let mut latest = None;
    while buffer.len() >= 4 {
        let length = u32::from_le_bytes(buffer[..4].try_into().unwrap()) as usize;
        if !(4..=4_400_000).contains(&length) { return Err("The screen helper returned an invalid frame.".into()); }
        if buffer.len() < length + 4 { break; }
        latest = Some(buffer[4..length + 4].to_vec());
        buffer.drain(..length + 4);
    }
    Ok(latest)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_fragmented_headers_and_frames() {
        let mut buffer = Vec::new();
        assert_eq!(decode_frames(&mut buffer, &[4, 0]).unwrap(), None);
        assert_eq!(decode_frames(&mut buffer, &[0, 0, 255]).unwrap(), None);
        assert_eq!(decode_frames(&mut buffer, &[216, 255, 217]).unwrap(), Some(vec![255, 216, 255, 217]));
        assert!(buffer.is_empty());
    }
    #[test]
    fn keeps_only_latest_complete_frame() {
        let mut buffer = Vec::new();
        assert_eq!(decode_frames(&mut buffer, &[4,0,0,0,1,2,3,4,4,0,0,0,5,6,7,8]).unwrap(), Some(vec![5,6,7,8]));
        assert!(buffer.is_empty());
    }
    #[test]
    fn rejects_unbounded_or_empty_frames() {
        assert!(decode_frames(&mut Vec::new(), &u32::MAX.to_le_bytes()).is_err());
        assert!(decode_frames(&mut Vec::new(), &[0,0,0,0]).is_err());
    }
}
