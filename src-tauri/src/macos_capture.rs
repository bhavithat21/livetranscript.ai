// macOS system-audio capture: spawns the ScreenCaptureKit Swift sidecar
// (src-tauri/binaries/audio-capture.swift) and forwards its raw Float32 48kHz
// mono PCM to the frontend as 16-bit little-endian PCM frames.
//
// Called by: src-tauri/src/lib.rs::start_native_audio (macOS only).
// Contract: the sidecar prints "READY" to stderr once capture is live, then
// streams contiguous f32 LE mono samples @48kHz on stdout (no header). start()
// BLOCKS until READY (or failure), so a returned Ok means audio is really
// flowing — a denied Screen-Recording permission returns Err and the caller
// falls back to the browser instead of silently recording nothing.
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

const SAMPLE_RATE: u32 = 48_000;
// ~50ms of mono @48k = 2400 samples. Emit frames near this size for low latency.
const FRAME_SAMPLES: usize = 2400;
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
    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    // Rendezvous: the reader task reports Ok once the sidecar prints READY, or
    // Err if it dies before then. start() blocks on this.
    let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    // Shared so the Stopper can kill the sidecar; the task also clears it on exit.
    let child = Arc::new(Mutex::new(Some(child)));
    let child_for_task = child.clone();
    // Guards against sending on init_tx more than once (READY then Terminated).
    let signalled = Arc::new(AtomicBool::new(false));
    let signalled_task = signalled.clone();

    async_runtime::spawn(async move {
        let mut ready = false;
        let mut carry: Vec<u8> = Vec::new(); // partial f32 across chunk boundaries
        let mut samples: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES);
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(bytes) => {
                    if !ready {
                        continue; // ignore audio until READY confirmed
                    }
                    carry.extend_from_slice(&bytes);
                    let n = carry.len() / 4;
                    for i in 0..n {
                        let b = &carry[i * 4..i * 4 + 4];
                        let f = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                        let c = f.clamp(-1.0, 1.0);
                        samples.push((if c < 0.0 { c * 32768.0 } else { c * 32767.0 }) as i16);
                        if samples.len() >= FRAME_SAMPLES {
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
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if !ready && text.contains("READY") {
                        ready = true;
                        signalled_task.store(true, Ordering::SeqCst);
                        let _ = init_tx.send(Ok(()));
                    } else {
                        eprintln!("[audio-capture] {}", text.trim_end());
                    }
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
        // Stream ended (killed by the Stopper, EOF, or crash). If we never hit
        // READY, report failure so start() returns Err.
        if !signalled_task.swap(true, Ordering::SeqCst) {
            let _ = init_tx.send(Err("sidecar exited before ready (permission denied?)".into()));
        }
        child_for_task.lock().unwrap().take(); // drop our child handle
    });

    // Block until the sidecar confirms capture, dies, or times out.
    let outcome = init_rx.recv_timeout(READY_TIMEOUT);
    match outcome {
        Ok(Ok(())) => {
            // Kill-driven teardown: dropping/killing the child closes stdout, so
            // the reader task's rx.recv() returns None and it exits cleanly.
            let stopper: Stopper = Box::new(move || {
                if let Some(c) = child.lock().unwrap().take() {
                    let _ = c.kill();
                }
            });
            Ok((SAMPLE_RATE, stopper))
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
