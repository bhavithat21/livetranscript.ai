'use client'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

// App-wide light/dark preference. Persisted in localStorage and applied as a
// class on <html> so plain CSS repaints everything — no theme prop threading
// through every component. Falls back to the OS setting when nothing is chosen.
//
// The class is ALSO set by a blocking inline script in app/layout.tsx so the
// correct theme is painted on first frame. That script and `read()` below must
// stay in sync — they read the same key with the same fallback, which is what
// keeps React's first render matching the pre-hydration DOM.
export const THEME_KEY = 'lt.theme'
export const DARK_CLASS = 'lt-dark'

export type ThemeMode = 'light' | 'dark'

// The preference lives outside React: read from localStorage, shared by every
// hook instance, and must survive remounts. Module state + a listener set is
// what useSyncExternalStore consumes, and it keeps the stored value out of an
// effect (a setState-in-effect would cascade an extra render on every mount).
let current: ThemeMode | null = null
const listeners = new Set<() => void>()

function read(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light' // storage/matchMedia unavailable
  }
}

function apply(theme: ThemeMode): void {
  document.documentElement.classList.toggle(DARK_CLASS, theme === 'dark')
}

// Runs on every render, so the localStorage hit is cached after the first read.
// Returns a primitive, so React's Object.is check stays stable.
function getSnapshot(): ThemeMode {
  if (current === null) current = read()
  return current
}

// The server has no localStorage. It always renders light; the inline script has
// already corrected the DOM by the time React hydrates.
function getServerSnapshot(): ThemeMode {
  return 'light'
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function set(next: ThemeMode): void {
  current = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    /* storage disabled — theme applies for this session only */
  }
  apply(next) // paint immediately, don't wait for a subscriber's effect
  for (const notify of listeners) notify()
}

export function useThemeMode() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Re-assert the class on mount. NO cleanup on unmount: the theme is global, so
  // navigating away from the screen that happens to host the toggle must not
  // strip it and snap the rest of the app back to light.
  useEffect(() => {
    apply(theme)
  }, [theme])

  const toggle = useCallback(() => set(getSnapshot() === 'dark' ? 'light' : 'dark'), [])

  return { theme, toggle, isDark: theme === 'dark' }
}
