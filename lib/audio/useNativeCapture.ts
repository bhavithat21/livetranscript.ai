import { useCallback, useRef } from 'react'
import type { MicStreamOptions } from './useMicStream'

// Native system-audio capture bridge for the Tauri desktop build. Mirrors
// useMicStream's start()/stop() so callers can try native first and fall back
// to browser getDisplayMedia when not running inside Tauri.
//
// On macOS this drives a ScreenCaptureKit sidecar; on Windows, cpal WASAPI
// loopback (see src-tauri/src/{macos,windows}_capture.rs). Both are passive
// output-mixer taps — the mic/speaker device is never seized, so a Zoom call
// keeps working with no echo. The remote web app is the same origin the Tauri
// window loads, so @tauri-apps/api resolves; its code only runs when isTauri().

// Tauri v2 always injects __TAURI_INTERNALS__ before page scripts (unlike
// __TAURI__, which needs withGlobalTauri). This is the reliable desktop detect.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function useNativeCapture() {
  const stoppingRef = useRef(false)

  // Returns the PCM sample rate on success, or 0 to signal "not native — the
  // caller should fall back to browser capture". Never throws for the
  // not-native case; only a real native start failure rejects.
  const start = useCallback(
    async (
      onPcm: (pcm: ArrayBuffer) => void,
      onLevel: (rms: number) => void,
      opts: MicStreamOptions = {},
    ): Promise<number> => {
      if (!isTauri()) return 0

      const { invoke, Channel } = await import('@tauri-apps/api/core')
      const channel = new Channel<ArrayBuffer>()

      channel.onmessage = (message) => {
        // InvokeResponseBody::Raw arrives as an ArrayBuffer (16-bit LE mono PCM).
        // Guard defensively in case a non-Raw body ever slips through.
        if (!(message instanceof ArrayBuffer)) return
        if (opts.isMuted?.()) {
          onLevel(0)
          return // muted: keep the tap alive but send nothing (same as useMicStream)
        }
        onPcm(message)
        onLevel(rms16(message))
      }

      stoppingRef.current = false
      // Rust arg is `on_frame` (snake_case); Tauri v2 maps camelCase `onFrame`.
      const rate = await invoke<number>('start_native_audio', { onFrame: channel })
      return rate
    },
    [],
  )

  const stop = useCallback(async () => {
    if (!isTauri() || stoppingRef.current) return
    stoppingRef.current = true
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('stop_native_audio')
  }, [])

  return { start, stop, isNative: isTauri() }
}

// RMS level (0..1) from a buffer of 16-bit little-endian PCM samples — mirrors
// the level the worklet reports so the caller's meter behaves identically.
function rms16(buf: ArrayBuffer): number {
  if (buf.byteLength < 2) return 0
  const pcm = new Int16Array(buf, 0, buf.byteLength >> 1)
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] / 32768
    sum += s * s
  }
  return Math.sqrt(sum / pcm.length)
}
