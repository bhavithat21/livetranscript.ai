'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_ANSWER_PREFERENCES, parseAnswerPreferences, type AnswerPreferences } from './answerPreferences'

const STORAGE_KEY = 'lt.answerPreferences'
const CHANGE_EVENT = 'lt:answer-preferences'
let cachedRaw: string | null | undefined
let cached = DEFAULT_ANSWER_PREFERENCES as AnswerPreferences

function snapshot(): AnswerPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== cachedRaw) {
      cachedRaw = raw
      try { cached = parseAnswerPreferences(raw ? JSON.parse(raw) : undefined) ?? { ...DEFAULT_ANSWER_PREFERENCES } }
      catch { cached = { ...DEFAULT_ANSWER_PREFERENCES } }
    }
  } catch { /* A blocked storage API leaves usable in-memory preferences. */ }
  return cached
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) listener() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE_EVENT, listener) }
}

export function useResponsePreferences() {
  const preferences = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_ANSWER_PREFERENCES as AnswerPreferences)
  const setPreferences = useCallback((update: AnswerPreferences | ((current: AnswerPreferences) => AnswerPreferences)) => {
    const next = parseAnswerPreferences(typeof update === 'function' ? update(snapshot()) : update)!
    cached = next
    try {
      const raw = JSON.stringify(next)
      window.localStorage.setItem(STORAGE_KEY, raw)
      cachedRaw = raw
    } catch { /* Controls continue to work for this page if storage is unavailable. */ }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])
  const setFormat = useCallback((format: AnswerPreferences['format']) => setPreferences((current) => ({ ...current, format })), [setPreferences])
  const setTone = useCallback((tone: AnswerPreferences['tone']) => setPreferences((current) => ({ ...current, tone })), [setPreferences])
  const setFollowups = useCallback((followups: boolean) => setPreferences((current) => ({ ...current, followups })), [setPreferences])
  return { preferences, setPreferences, setFormat, setTone, setFollowups }
}
