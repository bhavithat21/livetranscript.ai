'use client'
import { useEffect } from 'react'
import { isTauri } from '@/lib/audio/useNativeCapture'

// Ask for every OS permission the desktop app needs ONCE at launch, so the user
// is never interrupted mid-session. Two grants:
//   1. macOS Screen Recording — for the silent system-audio sidecar (native cmd).
//   2. Microphone — belongs to the webview, so getUserMedia drives its prompt.
// Runs only in the Tauri shell (isTauri); the browser build asks lazily as today.
// Renders nothing. Fire-and-forget: a denied grant just means the in-session flow
// re-prompts later, exactly as before — priming never blocks the app.
export function PermissionPrimer() {
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false

    ;(async () => {
      try {
        // Screen Recording first (native TCC prompt on macOS; no-op on Windows).
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('request_screen_capture_access')
      } catch {
        // Command missing on an older shell build → skip; capture will prompt later.
      }
      if (cancelled) return

      // Mic: open then immediately release. The open triggers the WKWebView prompt;
      // we don't keep the stream — recording opens its own when it starts.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
      } catch {
        // Denied/dismissed → the record flow re-prompts; nothing to do here.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
