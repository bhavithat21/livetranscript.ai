// macOS system-audio capture: spawns the ScreenCaptureKit Swift sidecar
// (src-tauri/binaries/audio-capture.swift) and forwards its raw Float32 48kHz
// mono PCM to the frontend as 16-bit little-endian PCM frames.
//
// Called by: src-tauri/src/lib.rs::start_native_audio (macOS only).
// Contract: the sidecar emits contiguous f32 LE mono samples @48kHz on stdout,
// no header. We convert to i16 LE and push ~50ms frames over the IPC Channel;
// the JS bridge (lib/audio/useNativeCapture.ts) receives them as ArrayBuffers.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::async_runtime;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const SAMPLE_RATE: u32 = 48_000;
// ~50ms of mono @48k = 2400 samples. Emit frames near this size for low latency.
const FRAME_SAMPLES: usize = 2400;

pub fn start(
    app: tauri::AppHandle,
    running: Arc<AtomicBool>,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let cmd = app
        .shell()
        .sidecar("audio-capture")
        .map_err(|e| format!("sidecar resolve failed: {e}"))?;
    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    async_runtime::spawn(async move {
        // Leftover bytes carried across chunk boundaries (f32 = 4 bytes).
        let mut carry: Vec<u8> = Vec::new();
        let mut samples: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES);
        while running.load(Ordering::Relaxed) {
            match rx.recv().await {
                Some(CommandEvent::Stdout(bytes)) => {
                    carry.extend_from_slice(&bytes);
                    let n = carry.len() / 4;
                    for i in 0..n {
                        let b = &carry[i * 4..i * 4 + 4];
                        let f = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                        let c = f.clamp(-1.0, 1.0);
                        samples.push((if c < 0.0 { c * 32768.0 } else { c * 32767.0 }) as i16);
                        if samples.len() >= FRAME_SAMPLES {
                            if send_i16(&on_frame, &samples).is_err() {
                                return;
                            }
                            samples.clear();
                        }
                    }
                    carry.drain(..n * 4);
                }
                Some(CommandEvent::Stderr(line)) => {
                    eprintln!("[audio-capture] {}", String::from_utf8_lossy(&line));
                }
                Some(CommandEvent::Terminated(_)) | None => break,
                _ => {}
            }
        }
        // Dropping `rx`/`_child` closes stdout -> SIGPIPE terminates the helper.
    });

    Ok(SAMPLE_RATE)
}

fn send_i16(ch: &Channel<InvokeResponseBody>, samples: &[i16]) -> Result<(), ()> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    ch.send(InvokeResponseBody::Raw(bytes)).map_err(|_| ())
}
