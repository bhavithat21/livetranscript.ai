'use client'
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PACK_IDS, resolveKeyterms } from './keytermPacks'

const STORAGE_KEY = 'lt.keytermPacks'

// Per-user keyterm-pack selection, persisted in localStorage (device-local prefs
// need no DB round-trip). Base pack is always applied by resolveKeyterms.
export function useKeytermPrefs() {
  const [enabledIds, setEnabledIds] = useState<string[]>(DEFAULT_PACK_IDS)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const parsed: unknown = JSON.parse(saved)
      // Must be a string[] — resolveKeyterms calls .includes on it, which throws
      // on a non-array. A tampered/legacy value falls back to defaults.
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        setEnabledIds(parsed)
      }
    } catch {
      /* corrupt/absent — keep defaults */
    }
  }, [])

  const toggle = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable — selection still applies this session */
      }
      return next
    })
  }, [])

  return { enabledIds, toggle, keyterms: resolveKeyterms(enabledIds) }
}
