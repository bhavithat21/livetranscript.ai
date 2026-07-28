import { useCallback, useRef } from 'react'
import type { MicStreamOptions } from './useMicStream'
import { logError } from '@/lib/log'

// Coerce whatever the Tauri IPC channel delivered into an ArrayBuffer, or null
// if it's not binary-shaped. Covers ArrayBuffer (docs), Uint8Array (observed on
// some webviews), and number[] (JSON-serialized fallback path).
function toArrayBuffer(message: unknown): ArrayBuffer | null {
  if (message instanceof ArrayBuffer) return message
  if (ArrayBuffer.isView(message)) {
    const v = message as Uint8Array
    // Copy so downstream owns a plain, exactly-sized ArrayBuffer.
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer
  }
  if (Array.isArray(message) && (message.length === 0 || typeof message[0] === 'number')) {
    return new Uint8Array(message as number[]).buffer as ArrayBuffer
  }
  return null
}

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

      let badShapeLogged = false
      channel.onmessage = (message) => {
        // InvokeResponseBody::Raw SHOULD arrive as an ArrayBuffer (16-bit LE mono
        // PCM), but the delivered shape varies by webview/Tauri version (typed
        // array, number[]). Coerce instead of dropping — a silent drop here kills
        // the meter AND transcription with zero errors anywhere.
        const pcm = toArrayBuffer(message)
        if (!pcm) {
          if (!badShapeLogged) {
            badShapeLogged = true
            logError('nativeCapture/frame-shape', new Error(`unexpected channel payload: ${Object.prototype.toString.call(message)}`))
          }
          return
        }
        if (opts.isMuted?.()) {
          onLevel(0)
          return // muted: keep the tap alive but send nothing (same as useMicStream)
        }
        onPcm(pcm)
        onLevel(rms16(pcm))
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
