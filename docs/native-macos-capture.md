# Native macOS (+ Windows) System-Audio Capture — Build Spec

**Status:** designed, not yet built. The one native capability that makes
LiveTranscript match Cluely on macOS: **full-system audio capture**, which a web
page cannot do on macOS (Apple sandboxes `getDisplayMedia` to tab-audio only).
The app already bundles as a native `.app`/`.dmg` via Tauri; this adds the
privileged native capture path.

## Why it's needed (the macOS gap)
- **Windows/web:** Chrome `getDisplayMedia` captures full-system loopback audio → hears the whole Zoom call. Works today.
- **macOS/web:** WKWebView `getDisplayMedia` = **tab audio only** (Apple privacy rule). Can't hear the Zoom *desktop app*.
- **Cluely's trick:** native app → **ScreenCaptureKit** (macOS 13+) with a one-time Screen-Recording permission reads system audio. Native code isn't sandboxed like a web page.

## Architecture (additive — web layer unchanged)
```
[macOS] ScreenCaptureKit audio   → Rust capture engine → 16k mono PCM frames
[Windows] WASAPI loopback        →   emits 'native-audio' tauri events
                                         ▼
  JS bridge (feature-detected): if (window.__TAURI__) useNativeCapture()
                                else useMicStream()  (web fallback)
                                         ▼
  existing ASR pipeline (connectWithFallback) — UNCHANGED downstream
```

## Steps
1. **Crate/helper:** a small Swift `SystemAudioDump` (ScreenCaptureKit) piped over stdout for macOS audio (more mature than `scap` v0.0.x for audio today); `scap`/WASAPI for Windows.
2. **Rust:** `#[tauri::command] start_native_audio(window)` spawns capture, downsamples to 16 kHz mono, emits ~50 ms frames via `window.emit("native-audio", ...)`; `stop_native_audio()` tears down.
3. **Permissions:** macOS Screen-Recording entitlement + TCC prompt on first use; Windows WASAPI needs none.
4. **JS bridge:** `lib/audio/useNativeCapture.ts` — feature-detected; feeds the same `onPcm` the worklet uses, else falls back to `useMicStream`. Browser build unchanged.
5. **Non-disruptive:** ScreenCaptureKit + WASAPI loopback are read-only taps of the output mixer — never seize the mic/speaker device, so Zoom keeps working, no echo. Full-system on macOS (unlike web tab-only).

## Unblocks
- macOS full-system audio (Zoom desktop app, not just a tab) → true Cluely parity.
- Pairs with shipped `contentProtected` (hidden from screen share) + transparent window + the `lt-desktop` glass theme → the complete invisible native copilot.

## Blocked on the founder
- **Apple Developer ($99/yr)** to sign + notarize so the ScreenCaptureKit permission works for distributed users (unsigned local builds can test with a manual grant).
- Decision: Swift helper vs `scap` for macOS audio (recommend Swift helper).

## Why not in this pass
A real-time native audio engine + PCM bridge needs iterative compile-and-test on
each OS; a stub that compiles but doesn't truly capture would read as done and
fail live. Deferred as a focused next build, not an unverifiable half-implementation.
