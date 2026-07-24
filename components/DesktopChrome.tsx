'use client'
import { useEffect } from 'react'

// Marks the document as running inside the native Tauri shell (window.__TAURI__)
// by adding `lt-desktop` to <html>. That class flips the app to its transparent
// "glass overlay" theme (see globals.css) so the desktop window shows through —
// Cluely-style. In a normal browser the class is never added, so the web app is
// completely unaffected. Renders nothing.
export function DesktopChrome() {
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
    if (isTauri) document.documentElement.classList.add('lt-desktop')
    return () => document.documentElement.classList.remove('lt-desktop')
  }, [])
  return null
}
