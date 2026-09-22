'use client'
import { useCallback } from 'react'
import { useStoredPreference } from '../browser/useStoredPreference'

// Per-device, per-room overrides for how YOU see each participant: a custom name
// and/or a color slot (0–4). Local only — saved to localStorage, never broadcast,
// so relabeling never changes anyone else's view (the chosen model). Keyed by the
// participant's stable Ably clientId.
export interface SpeakerPref {
  name?: string
  colorSlot?: number
}
export type SpeakerPrefs = Record<string, SpeakerPref>

const key = (roomId: string) => `lt.speakerPrefs.${roomId}`
const EMPTY_PREFS: SpeakerPrefs = {}

function parsePrefs(raw: string): SpeakerPrefs {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_PREFS
  return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const pref = entry as SpeakerPref
    return [[id, {
      ...(typeof pref.name === 'string' ? { name: pref.name } : {}),
      ...(typeof pref.colorSlot === 'number' && Number.isInteger(pref.colorSlot) && pref.colorSlot >= 0 && pref.colorSlot <= 4
        ? { colorSlot: pref.colorSlot } : {}),
    }]]
  }))
}

export function useSpeakerPrefs(roomId: string) {
  const { value: prefs, setValue } = useStoredPreference(key(roomId), EMPTY_PREFS, parsePrefs)

  // Immutable update of one participant's pref; empty name clears the override.
  const setPref = useCallback(
    (clientId: string, patch: SpeakerPref) => {
      setValue((current) => {
        const merged: SpeakerPref = { ...current[clientId], ...patch }
        if (typeof merged.name === 'string' && !merged.name.trim()) delete merged.name
        const next = { ...current, [clientId]: merged }
        if (merged.name === undefined && merged.colorSlot === undefined) delete next[clientId]
        return next
      })
    },
    [setValue],
  )

  return { prefs, setPref }
}
