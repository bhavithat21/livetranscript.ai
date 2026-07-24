// Windows system-audio capture via cpal WASAPI loopback.
//
// Called by: src-tauri/src/lib.rs::start_native_audio (Windows only).
// Building an INPUT stream on the default OUTPUT (render) device makes cpal set
// AUDCLNT_STREAMFLAGS_LOOPBACK in SHARED mode -> a passive tap of the post-mix
// render stream. Zoom keeps playing normally; the device is never seized.
// Downmixed to mono i16 at the endpoint's native rate (returned to the caller,
// which passes it to the STT provider — no resampling here).
//
// cpal's `Stream` is !Send, so it must be BUILT and OWNED on a single thread. We
// spawn that thread, build+play the stream there, report the sample rate back
// over a rendezvous channel, then keep the thread alive (holding the stream)
// while it drains captured frames to the IPC channel until `running` clears.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use crossbeam_channel::{bounded, TrySendError};
use tauri::ipc::{Channel, InvokeResponseBody};

const FRAME_SAMPLES: usize = 2400; // ~50ms @48k mono

pub fn start(
    running: Arc<AtomicBool>,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    // Rendezvous: the capture thread reports Ok(rate) once the stream is live,
    // or Err(msg) if device open/build/play failed. start() blocks on this.
    let (init_tx, init_rx) = bounded::<Result<u32, String>>(1);

    thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_output_device() {
            Some(d) => d,
            None => {
                let _ = init_tx.send(Err("no default output device".into()));
                return;
            }
        };
        let default_cfg = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = init_tx.send(Err(e.to_string()));
                return;
            }
        };
        let sample_format = default_cfg.sample_format();
        let channels = default_cfg.channels() as usize;
        let rate = default_cfg.sample_rate().0;
        let config: cpal::StreamConfig = default_cfg.into();

        // Bounded: a slow consumer drops whole frames rather than growing unbounded.
        let (tx, rx) = bounded::<Vec<i16>>(64);
        let mut acc: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES);

        let push = move |mono: f32, acc: &mut Vec<i16>, tx: &crossbeam_channel::Sender<Vec<i16>>| {
            let c = mono.clamp(-1.0, 1.0);
            acc.push((if c < 0.0 { c * 32768.0 } else { c * 32767.0 }) as i16);
            if acc.len() >= FRAME_SAMPLES {
                match tx.try_send(std::mem::take(acc)) {
                    Ok(()) | Err(TrySendError::Full(_)) => acc.clear(),
                    Err(TrySendError::Disconnected(_)) => {}
                }
            }
        };

        let err_fn = |e: cpal::StreamError| eprintln!("[loopback] stream error: {e}");
        let tx_cb = tx.clone();
        let built = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _: &_| {
                    for frame in data.chunks(channels) {
                        let m = frame.iter().copied().sum::<f32>() / channels as f32;
                        push(m, &mut acc, &tx_cb);
                    }
                },
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _: &_| {
                    for frame in data.chunks(channels) {
                        let m = frame.iter().map(|&s| s as f32 / 32768.0).sum::<f32>()
                            / channels as f32;
                        push(m, &mut acc, &tx_cb);
                    }
                },
                err_fn,
                None,
            ),
            other => {
                let _ = init_tx.send(Err(format!("unsupported loopback sample format: {other:?}")));
                return;
            }
        };
        let stream = match built {
            Ok(s) => s,
            Err(e) => {
                let _ = init_tx.send(Err(e.to_string()));
                return;
            }
        };
        if let Err(e) = stream.play() {
            let _ = init_tx.send(Err(e.to_string()));
            return;
        }
        // Stream is live — unblock the caller with the native rate.
        let _ = init_tx.send(Ok(rate));

        // Hold the stream on this thread (dropping it stops capture) and forward
        // frames to the IPC channel until stop clears `running`.
        while running.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(samples) => {
                    let mut bytes = Vec::with_capacity(samples.len() * 2);
                    for s in samples {
                        bytes.extend_from_slice(&s.to_le_bytes());
                    }
                    if on_frame.send(InvokeResponseBody::Raw(bytes)).is_err() {
                        break;
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            }
        }
        // stream drops here -> capture stops
    });

    match init_rx.recv() {
        Ok(result) => result,
        Err(_) => Err("capture thread died during init".into()),
    }
}
