'use client'
import { useEffect } from 'react'

// Marks the document as running inside the native Tauri shell by adding
// `lt-desktop` to <html>. That class flips the app to its transparent "glass
// overlay" theme (see globals.css) so the desktop window shows through —
// Cluely-style. In a normal browser the class is never added, so the web app is
// completely unaffected. Renders nothing.
//
// Detect via __TAURI_INTERNALS__, which Tauri v2 ALWAYS injects before page
// scripts. (__TAURI__ only exists when `withGlobalTauri` is enabled, which we
// don't set — using it here meant the class never applied and transparency
// never turned on. Matches the detect in lib/audio/useNativeCapture.ts.)
export function DesktopChrome() {
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    if (isTauri) document.documentElement.classList.add('lt-desktop')
    return () => document.documentElement.classList.remove('lt-desktop')
  }, [])
  return null
}
