'use client'
import { useCallback } from 'react'
import { useStoredPreference } from '../browser/useStoredPreference'
import { DEFAULT_PACK_IDS, resolveKeyterms } from './keytermPacks'

const STORAGE_KEY = 'lt.keytermPacks'

function parseKeyterms(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? parsed : DEFAULT_PACK_IDS
}

// Per-user keyterm-pack selection, persisted in localStorage (device-local prefs
// need no DB round-trip). Base pack is always applied by resolveKeyterms.
export function useKeytermPrefs() {
  const { value: enabledIds, setValue } = useStoredPreference(STORAGE_KEY, DEFAULT_PACK_IDS, parseKeyterms)

  const toggle = useCallback((id: string) => {
    setValue((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }, [setValue])

  return { enabledIds, toggle, keyterms: resolveKeyterms(enabledIds) }
}
