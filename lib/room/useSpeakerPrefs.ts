'use client'
import { useCallback, useEffect, useState } from 'react'

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

export function useSpeakerPrefs(roomId: string) {
  const [prefs, setPrefs] = useState<SpeakerPrefs>({})

  // Load once per room.
  useEffect(() => {
    if (!roomId) return
    try {
      const raw = localStorage.getItem(key(roomId))
      setPrefs(raw ? (JSON.parse(raw) as SpeakerPrefs) : {})
    } catch {
      setPrefs({})
    }
  }, [roomId])

  const persist = useCallback(
    (next: SpeakerPrefs) => {
      setPrefs(next)
      try {
        localStorage.setItem(key(roomId), JSON.stringify(next))
      } catch {
        /* storage full / disabled — overrides just won't persist */
      }
    },
    [roomId],
  )

  // Immutable update of one participant's pref; empty name clears the override.
  const setPref = useCallback(
    (clientId: string, patch: SpeakerPref) => {
      const merged: SpeakerPref = { ...prefs[clientId], ...patch }
      if (typeof merged.name === 'string' && !merged.name.trim()) delete merged.name
      const next = { ...prefs, [clientId]: merged }
      if (merged.name === undefined && merged.colorSlot === undefined) delete next[clientId]
      persist(next)
    },
    [prefs, persist],
  )

  return { prefs, setPref }
}
