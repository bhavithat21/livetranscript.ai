'use client'
import { useCallback, useEffect } from 'react'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'
import { DEFAULT_ICON, parseStoredIcon, type AppIcon } from './icons'

export const APP_NAME_KEY = 'lt.appName'
export const APP_ICON_KEY = 'lt.appIcon'
export const DEFAULT_APP_NAME = 'LiveTranscript'
export const MAX_APP_NAME_LENGTH = 40
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')
const serializeName = (value: string) => value
const serializeIcon = (value: AppIcon) => JSON.stringify(value)

export const IDENTITY_PRESETS = [
  { id: 'default', label: 'LiveTranscript (default)', title: DEFAULT_APP_NAME },
  { id: 'notes', label: 'Notes', title: 'Notes' },
  { id: 'reader', label: 'Reader', title: 'Reader' },
  { id: 'docs', label: 'Document', title: 'Document' },
  { id: 'preview', label: 'Preview', title: 'Preview' },
] as const

export function normalizeName(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim().slice(0, MAX_APP_NAME_LENGTH) || DEFAULT_APP_NAME
}

export function hasAppName(value: string): boolean {
  return Boolean(value.replace(CONTROL_CHARS, '').trim())
}

/** One preference owner for the header, browser tab and native window. */
export function useAppIdentity() {
  const { value: name, setValue: setName, clear: clearName } = useStoredPreference(APP_NAME_KEY, DEFAULT_APP_NAME, normalizeName, serializeName)
  const { value: icon, setValue: setStoredIcon, clear: clearIcon } = useStoredPreference(APP_ICON_KEY, DEFAULT_ICON, parseStoredIcon, serializeIcon)

  const save = useCallback((next: string): boolean => {
    const value = normalizeName(next)
    return value === DEFAULT_APP_NAME ? clearName() : setName(value)
  }, [clearName, setName])

  // The old desktop picker cannot compete with the canonical app name or return
  // after reset. Canonical names take precedence when both preferences exist.
  useEffect(() => {
    try {
      const legacyId = localStorage.getItem('lt.identity')
      if (legacyId === null) return
      if (localStorage.getItem(APP_NAME_KEY) === null) {
        const preset = IDENTITY_PRESETS.find((entry) => entry.id === legacyId)
        if (preset && preset.id !== 'default') save(preset.title)
      }
      localStorage.removeItem('lt.identity')
    } catch {
      // Storage may be disabled; useStoredPreference still works for this session.
    }
  }, [save])

  const setIcon = useCallback((next: AppIcon): boolean => {
    const validated = parseStoredIcon(serializeIcon(next))
    return validated.kind === 'preset' && validated.id === 'default'
      ? clearIcon()
      : setStoredIcon(validated)
  }, [clearIcon, setStoredIcon])

  const reset = useCallback((): boolean => {
    const nameSaved = clearName()
    const iconSaved = clearIcon()
    return nameSaved && iconSaved
  }, [clearName, clearIcon])

  return {
    name,
    icon,
    isCustom: name !== DEFAULT_APP_NAME || icon.kind !== 'preset' || icon.id !== 'default',
    save,
    setIcon,
    reset,
  }
}
