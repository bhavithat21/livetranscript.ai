'use client'

import { useCallback, useEffect, useRef } from 'react'
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

type NativeSession = {
  cancelled: boolean
  start: Promise<number>
  stop: Promise<void> | null
}

// Native capture is a single OS resource. Serialize acquisition/retirement even
// across route changes: a late stop from an unmounted hook must never terminate
// the replacement page's capture. A stop requested during a permission dialog
// also runs after acquisition, when Rust has installed the session's stopper.
let commandTail: Promise<void> = Promise.resolve()
let nativeOwner: NativeSession | null = null

function serializeNative<T>(operation: () => Promise<T>): Promise<T> {
  const result = commandTail.then(operation)
  commandTail = result.then(() => {}, () => {})
  return result
}

function cancelError() {
  return new DOMException('Audio capture cancelled', 'AbortError')
}

export function useNativeCapture() {
  const sessionRef = useRef<NativeSession | null>(null)

  const stop = useCallback((): Promise<void> => {
    const session = sessionRef.current
    if (!session) return Promise.resolve()
    session.cancelled = true
    if (session.stop) return session.stop
    session.stop = serializeNative(async () => {
      if (nativeOwner !== session) return
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('stop_native_audio')
      if (nativeOwner === session) nativeOwner = null
    })
    return session.stop
  }, [])

  useEffect(() => () => { void stop().catch(() => {}) }, [stop])

  const start = useCallback((
    onPcm: (pcm: ArrayBuffer) => void,
    onLevel: (rms: number) => void,
    opts: MicStreamOptions = {},
  ): Promise<number> => {
    if (!isTauri()) return Promise.resolve(0)
    const existing = sessionRef.current
    if (existing && !existing.cancelled) return existing.start
    const session: NativeSession = { cancelled: false, start: Promise.resolve(0), stop: null }
    sessionRef.current = session
    session.start = serializeNative(async () => {
      if (session.cancelled) throw cancelError()
      const { invoke, Channel } = await import('@tauri-apps/api/core')
      if (session.cancelled) throw cancelError()
      const channel = new Channel<ArrayBuffer>()
      let badShapeLogged = false
      channel.onmessage = (message) => {
        if (session.cancelled || nativeOwner !== session) return
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
          return
        }
        onPcm(pcm)
        onLevel(rms16(pcm))
      }

      nativeOwner = session
      try {
        const rate = await invoke<number>('start_native_audio', { onFrame: channel })
        if (session.cancelled) {
          await invoke('stop_native_audio')
          if (nativeOwner === session) nativeOwner = null
          throw cancelError()
        }
        return rate
      } catch (cause) {
        session.cancelled = true
        if (nativeOwner === session) {
          // Also retire a partially acquired native session after a start error.
          try {
            await invoke('stop_native_audio')
            nativeOwner = null
          } catch { /* a queued explicit stop may retry */ }
        }
        throw cause
      }
    })
    return session.start
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
