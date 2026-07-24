'use client'
import { useCallback, useEffect, useState } from 'react'

// Per-device app identity: a display name the user can set, applied to the header
// wordmark and the browser/desktop-window title. Works identically on web, Mac,
// and Windows because the desktop app loads the same web layer — so the in-app
// name is consistent everywhere. (The OS-installed name/icon in the Dock/Start
// menu is baked into the signed installer and cannot change per user; this
// controls the in-app chrome, which is what the user actually looks at.)
//
// Stored in localStorage (no account needed). Blank/whitespace => the default.

const KEY = 'lt.appName'
export const DEFAULT_APP_NAME = 'LiveTranscript'
const MAX_LEN = 40
// C0 control chars + DEL, built without literal control chars in source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')

function read(): string {
  try {
    const v = localStorage.getItem(KEY)?.trim()
    return v || DEFAULT_APP_NAME
  } catch {
    return DEFAULT_APP_NAME
  }
}

export function useAppIdentity() {
  const [name, setName] = useState(DEFAULT_APP_NAME)

  useEffect(() => {
    setName(read())
  }, [])

  // Keep the document/window title in sync with the chosen name.
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = name
  }, [name])

  const save = useCallback((next: string) => {
    const clean = next.replace(CONTROL_CHARS, '').trim().slice(0, MAX_LEN)
    const value = clean || DEFAULT_APP_NAME
    setName(value)
    try {
      if (clean) localStorage.setItem(KEY, clean)
      else localStorage.removeItem(KEY)
    } catch {
      /* storage disabled — applies for this session only */
    }
  }, [])

  const reset = useCallback(() => save(''), [save])

  return { name, isCustom: name !== DEFAULT_APP_NAME, save, reset }
}
