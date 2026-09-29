// macOS system-audio capture: spawns the Swift sidecar
// (src-tauri/binaries/audio-capture.swift) and forwards its raw Float32 mono
// PCM to the frontend as 16-bit little-endian PCM frames. macOS 14+ uses
// the system content picker; macOS 13 uses the legacy recording grant.
// Contract: RATE <hz> then READY on stderr, contiguous f32 LE on stdout.
// start() blocks on a background thread until READY, failure, or timeout.
//
// Teardown is kill-driven: start() returns a Stopper that kills the sidecar.
// Killing it closes stdout, so the reader task's rx.recv() returns None and the
// task exits — no polling, no leaked process, prompt even if the stream stalled.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::async_runtime;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::Stopper;

// Fallback if the sidecar predates the RATE line (never expected post-0.1.5).
const DEFAULT_SAMPLE_RATE: u32 = 48_000;
// Emit ~50ms frames for low latency (samples = rate / 20).
const FRAME_MS_DIVISOR: u32 = 20;
// Max wait for the sidecar's READY sentinel (covers the interactive
// Screen-Recording permission prompt on first run).
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub fn start(
    app: tauri::AppHandle,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<(u32, Stopper), String> {
    let cmd = app
        .shell()
        .sidecar("audio-capture")
        .map_err(|e| format!("sidecar resolve failed: {e}"))?;
    let (mut rx, child) = cmd
        .set_raw_out(true)
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    // Rendezvous: the reader task reports Ok(rate) once the sidecar prints
    // READY (rate from the preceding RATE line), or Err if it dies before then.
    // start() blocks on this.
    let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    // Shared so the Stopper can kill the sidecar; the task also clears it on exit.
    let child = Arc::new(Mutex::new(Some(child)));
    let child_for_task = child.clone();
    // Guards against sending on init_tx more than once (READY then Terminated).
    let signalled = Arc::new(AtomicBool::new(false));
    let signalled_task = signalled.clone();

    async_runtime::spawn(async move {
        let mut diagnostics = Vec::new();
        let mut last_error = String::new();
        let mut ready = false;
        let mut rate = DEFAULT_SAMPLE_RATE;
        let mut frame_samples = (rate / FRAME_MS_DIVISOR) as usize;
        let mut carry: Vec<u8> = Vec::new(); // partial f32 across chunk boundaries
        let mut samples: Vec<i16> = Vec::with_capacity(frame_samples);
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(bytes) => {
                    carry.extend_from_slice(&bytes);
                    if !ready {
                        // Keep byte alignment when stdout races the stderr READY
                        // sentinel. Bound startup buffering to one second of f32.
                        if carry.len() > 768_000 {
                            let discard = ((carry.len() - 768_000) / 4) * 4;
                            carry.drain(..discard);
                        }
                        continue;
                    }
                    let n = carry.len() / 4;
                    for i in 0..n {
                        let b = &carry[i * 4..i * 4 + 4];
                        let f = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                        let c = f.clamp(-1.0, 1.0);
                        samples.push((if c < 0.0 { c * 32768.0 } else { c * 32767.0 }) as i16);
                        if samples.len() >= frame_samples {
                            if send_i16(&on_frame, &samples).is_err() {
                                // Frontend channel gone → kill the sidecar and stop.
                                if let Some(c) = child_for_task.lock().unwrap().take() {
                                    let _ = c.kill();
                                }
                                return;
                            }
                            samples.clear();
                        }
                    }
                    carry.drain(..n * 4);
                }
                CommandEvent::Stderr(bytes) => {
                    for text in diagnostic_lines(&mut diagnostics, &bytes) {
                        if !ready {
                            if let Some(r) = text
                                .strip_prefix("RATE ")
                                .and_then(|v| v.parse::<u32>().ok())
                            {
                                if (8_000..=192_000).contains(&r) {
                                    rate = r;
                                    frame_samples = (rate / FRAME_MS_DIVISOR) as usize;
                                }
                                continue;
                            }
                            if text == "READY" {
                                ready = true;
                                signalled_task.store(true, Ordering::SeqCst);
                                let _ = init_tx.send(Ok(rate));
                                continue;
                            }
                            last_error = text.clone();
                        }
                        eprintln!("[audio-capture] {text}");
                    }
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
        // Stream ended (killed by the Stopper, EOF, or crash). If we never hit
        // READY, report failure so start() returns Err.
        if !signalled_task.swap(true, Ordering::SeqCst) {
            let _ = init_tx.send(Err(if last_error.is_empty() {
                "Audio capture ended before it was ready. Try selecting call audio again.".into()
            } else {
                last_error
            }));
        }
        child_for_task.lock().unwrap().take(); // drop our child handle
    });

    // Block until the sidecar confirms capture, dies, or times out.
    let outcome = init_rx.recv_timeout(READY_TIMEOUT);
    match outcome {
        Ok(Ok(rate)) => {
            // Kill-driven teardown: dropping/killing the child closes stdout, so
            // the reader task's rx.recv() returns None and it exits cleanly.
            let stopper: Stopper = Box::new(move || {
                if let Some(c) = child.lock().unwrap().take() {
                    let _ = c.kill();
                }
            });
            Ok((rate, stopper))
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            if let Some(c) = child.lock().unwrap().take() {
                let _ = c.kill();
            }
            Err("timed out waiting for audio capture to start".into())
        }
    }
}

fn send_i16(ch: &Channel<InvokeResponseBody>, samples: &[i16]) -> Result<(), ()> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    ch.send(InvokeResponseBody::Raw(bytes)).map_err(|_| ())
}

// Raw shell output can split or combine stderr lines independently of stdout.
fn diagnostic_lines(pending: &mut Vec<u8>, bytes: &[u8]) -> Vec<String> {
    let mut lines = Vec::new();
    for byte in bytes {
        if *byte == b'\n' {
            lines.push(String::from_utf8_lossy(pending).trim().to_owned());
            pending.clear();
        } else if pending.len() < 8192 {
            pending.push(*byte);
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::diagnostic_lines;
    #[test]
    fn readiness_survives_split_and_combined_raw_chunks() {
        let mut pending = Vec::new();
        assert!(diagnostic_lines(&mut pending, b"RA").is_empty());
        assert_eq!(
            diagnostic_lines(&mut pending, b"TE 48000\nREA"),
            vec!["RATE 48000"]
        );
        assert_eq!(
            diagnostic_lines(&mut pending, b"DY\nFailure message\n"),
            vec!["READY", "Failure message"]
        );
        assert!(pending.is_empty());
    }
    #[test]
    fn malformed_diagnostics_are_bounded() {
        let mut pending = Vec::new();
        diagnostic_lines(&mut pending, &vec![b'x'; 100_000]);
        assert_eq!(pending.len(), 8192);
    }
}
