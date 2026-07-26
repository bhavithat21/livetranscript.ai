'use client'
import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@/lib/audio/useNativeCapture'

// Lock (click-through) mode for the desktop overlay. Turning it ON makes the
// window pass all mouse/keyboard through to the apps behind it and pins it
// always-on-top, so the user keeps working elsewhere with the transcript/AI
// floating on top, view-only.
//
// IMPORTANT: once locked, the window can't be clicked — so you CANNOT unlock from
// an in-window button. The escape hatches are the global hotkey (Cmd/Ctrl+Shift+L)
// and the tray "Lock (click-through) mode" item, both native. This hook only
// drives the ON action + reflects state; it polls native state so the label stays
// correct after a hotkey/tray toggle. No-op in the browser.
export function useLockMode() {
  const available = isTauri()
  const [locked, setLocked] = useState(false)

  // Reflect native state (a hotkey/tray toggle changes it outside this hook).
  useEffect(() => {
    if (!available) return
    let alive = true
    let timer: ReturnType<typeof setInterval>
    ;(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const sync = async () => {
        try {
          const v = await invoke<boolean>('get_lock_mode')
          if (alive) setLocked(v)
        } catch {
          /* command missing on an older shell → leave as-is */
        }
      }
      await sync()
      timer = setInterval(sync, 1500) // catch hotkey/tray toggles
    })()
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [available])

  const enable = useCallback(async () => {
    if (!available) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_lock_mode', { enabled: true })
      setLocked(true)
    } catch {
      /* older shell without the command → nothing to do */
    }
  }, [available])

  return { available, locked, enable }
}
