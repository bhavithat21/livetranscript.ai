# Native macOS and Windows system-audio capture

**Status:** implemented in source for the Tauri desktop app. macOS uses a
ScreenCaptureKit Swift sidecar; Windows uses WASAPI loopback through `cpal`.
Physical-device acceptance, signing/notarization, and stable installer promotion
remain separate release gates.

## Why the native path is needed

- **Windows/web:** browser `getDisplayMedia` support depends on the selected
  surface and browser.
- **macOS/web:** a web page cannot reliably capture audio from desktop apps such
  as Zoom.
- **Desktop app:** a native, read-only tap can capture the selected system output
  without routing audio through a new application server.

## Implemented architecture

```
macOS ScreenCaptureKit helper → Float32 mono PCM ┐
                                                  ├→ Rust/Tauri → 16-bit PCM channel
Windows WASAPI loopback      → mono PCM          ┘
                                                            ↓
                                             useNativeCapture()
                                                            ↓
                                      existing ASR provider pipeline
```

The native path is additive. `lib/audio/useNativeCapture.ts` detects Tauri,
serializes start/stop operations, forwards binary frames to the existing PCM
callback, computes the same RMS level used by the browser meter, and ignores
late frames from retired sessions. A normal web page receives no native
capability.

### macOS

- `src-tauri/binaries/audio-capture.swift` captures system audio with
  ScreenCaptureKit. macOS 14 and later use the system content picker; macOS 13
  uses the legacy Screen Recording grant.
- The helper writes raw mono Float32 PCM to stdout and reports `RATE` followed
  by `READY` on stderr. It excludes the app's own audio to avoid feedback.
- `src-tauri/src/macos_capture.rs` waits up to 30 seconds for readiness,
  converts samples to little-endian 16-bit PCM, emits roughly 50 ms frames, and
  terminates the helper on stop or when the frontend channel disappears.
- `scripts/build-audio-helper.sh` builds arm64, x86_64, and universal sidecars
  consumed by the Tauri bundle.

### Windows

- `src-tauri/src/windows_capture.rs` opens the default output device in WASAPI
  loopback mode, downmixes to mono 16-bit PCM, and forwards bounded roughly
  50 ms frames.
- The callback-to-IPC queue holds at most 64 frames. A slow consumer drops whole
  frames instead of allowing unbounded memory growth.
- Stopping the session retires the capture thread and drops its stream.

Both implementations return the actual device sample rate to the web layer.
They are passive output-mixer taps: they do not seize the microphone or speaker
device, and downstream provider selection remains unchanged.

## Failure and lifecycle boundaries

A successful native start means the platform capture reported ready; it does not
prove that useful speech was present or transcribed. The macOS bridge exposes
allowlisted lifecycle stages, and unexpected helper termination is surfaced to
the UI so call audio can be retried without stopping microphone or screen
capture. Native logs are stored locally under
`~/Library/Logs/LiveTranscript/native-audio.log`, with bounded rotation and
owner-only permissions.

A hosted web deployment cannot add or replace native commands in an already
installed shell. Changes to the Swift helper, Rust bridge, entitlements, or
bundled sidecar require a newly built desktop installer.

## Remaining release validation

Before stable promotion, test a signed/notarized macOS installer and a Windows
installer on physical devices. Verify first-run permission or picker flows,
cancel and retry, actual Zoom/Teams system speech, simultaneous microphone
capture, mute/unmute, Stop during startup, unexpected helper/device loss, and a
new finalized utterance after recovery. A successful compile, synthetic PCM
test, or `READY` event alone is not evidence that distributed capture works
end to end.
