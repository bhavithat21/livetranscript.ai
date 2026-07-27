'use client'
import { useCallback, useEffect, useState } from 'react'

// In-app "disguise" picker for the DESKTOP app. Interviewers glancing at a shared
// screen or a window list clock an obvious name like "LiveTranscript". This lets the
// user pick a neutral window title at runtime.
//
// HONEST SCOPE — what this can and cannot do (Tauri runtime limits):
//   ✅ Window TITLE (window bar; some screen-share/window-picker lists read this).
//   ❌ The installed app/binary name, macOS Dock label, and the app ICON are baked
//      into the bundle at BUILD time — a running app can't rewrite them. Those need a
//      rebuilt installer (tauri.conf.json productName + icons/). The UI says so, so
//      this is never oversold as full invisibility.
// No-op in the browser (no window to retitle). Choice persists per device.

export const IDENTITY_PRESETS = [
  { id: 'default', label: 'LiveTranscript (default)', title: 'LiveTranscript' },
  { id: 'notes', label: 'Notes', title: 'Notes' },
  { id: 'reader', label: 'Reader', title: 'Reader' },
  { id: 'docs', label: 'Document', title: 'Document' },
  { id: 'preview', label: 'Preview', title: 'Preview' },
] as const

const KEY = 'lt.identity'

export function useAppIdentity() {
  const [available, setAvailable] = useState(false)
  const [current, setCurrent] = useState<string>('default')

  // Desktop only. Apply the persisted choice on mount so it survives relaunch.
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
    setAvailable(true)
    const saved = (() => {
      try {
        return localStorage.getItem(KEY) || 'default'
      } catch {
        return 'default'
      }
    })()
    setCurrent(saved)
    void applyTitle(saved)
  }, [])

  const applyTitle = async (id: string) => {
    const preset = IDENTITY_PRESETS.find((p) => p.id === id) ?? IDENTITY_PRESETS[0]
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setTitle(preset.title)
    } catch {
      /* not desktop / API unavailable — no-op */
    }
  }

  const setIdentity = useCallback((id: string) => {
    setCurrent(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
    void applyTitle(id)
  }, [])

  return { available, current, presets: IDENTITY_PRESETS, setIdentity }
}
