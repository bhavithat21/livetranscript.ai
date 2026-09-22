'use client'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

const CHANGE_EVENT = 'lt:stored-preference-change'
// A failed storage write must still update the active session, including other
// consumers of the same preference. This map is only accessed in the browser.
const sessionValues = new Map<string, string | null>()

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  if (sessionValues.has(key)) return sessionValues.get(key) ?? null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, raw: string | null): boolean {
  if (typeof window === 'undefined') return false
  let saved = true
  try {
    if (raw === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, raw)
    sessionValues.delete(key)
  } catch {
    sessionValues.set(key, raw)
    saved = false
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }))
  return saved
}

function serverSnapshot(): null {
  return null
}

/** JSON preference with stable SSR snapshots and same-tab/cross-tab updates. */
export function useStoredPreference<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T = JSON.parse,
  serialize: (value: T) => string = JSON.stringify,
) {
  const decode = useCallback((raw: string | null): T => {
    if (raw === null) return fallback
    try {
      return parse(raw)
    } catch {
      return fallback
    }
  }, [fallback, parse])

  const subscribe = useCallback((notify: () => void) => {
    const onLocalChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) notify()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return
      } catch {
        return
      }
      sessionValues.delete(key)
      notify()
    }
    window.addEventListener(CHANGE_EVENT, onLocalChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onLocalChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [key])
  const getSnapshot = useCallback(() => read(key), [key])
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
  const value = useMemo(() => decode(raw), [decode, raw])

  const setValue = useCallback((update: T | ((current: T) => T)): boolean => {
    const next = typeof update === 'function'
      ? (update as (current: T) => T)(decode(read(key)))
      : update
    return write(key, serialize(next))
  }, [key, decode, serialize])
  const clear = useCallback(() => write(key, null), [key])

  return { value, setValue, clear }
}
