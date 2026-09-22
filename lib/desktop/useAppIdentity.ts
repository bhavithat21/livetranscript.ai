'use client'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'

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
const subscribeToRuntime = () => () => {}
const desktopAvailable = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const serverDesktopAvailable = () => false
const parseIdentity = (id: string) => IDENTITY_PRESETS.some((preset) => preset.id === id) ? id : 'default'
const serializeIdentity = (id: string) => id

async function applyTitle(id: string): Promise<void> {
  const preset = IDENTITY_PRESETS.find((p) => p.id === id) ?? IDENTITY_PRESETS[0]
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTitle(preset.title)
  } catch {
    /* not desktop / API unavailable — no-op */
  }
}

export function useAppIdentity() {
  const available = useSyncExternalStore(subscribeToRuntime, desktopAvailable, serverDesktopAvailable)
  const { value: current, setValue } = useStoredPreference(KEY, 'default', parseIdentity, serializeIdentity)

  // Desktop only. Apply the persisted choice on mount so it survives relaunch.
  useEffect(() => {
    if (available) void applyTitle(current)
  }, [available, current])

  const setIdentity = useCallback((id: string) => {
    setValue(parseIdentity(id))
  }, [setValue])

  return { available, current, presets: IDENTITY_PRESETS, setIdentity }
}
