'use client'
import { useCallback, useState } from 'react'
import { useStoredPreference } from '../browser/useStoredPreference'

// Resume + job description as FIRST-CLASS context — distinct from the per-mode doc
// corpus. A candidate has ONE resume and ONE target JD, and they ground EVERY mode:
// coding (language/stack the JD implies), behavioral (which of the candidate's real
// projects to draw on), system design (domain), general. So unlike uploaded docs
// these are:
//   - GLOBAL (one store, not per-mode) — set once, used everywhere
//   - ALWAYS injected, never retrieved — they're always relevant, so no embedding /
//     similarity gate; the model gets them verbatim (capped) on every answer.
// Stored on-device (localStorage), same privacy posture as the rest of the context.

const KEY = 'lt.profile'
const MAX_RESUME = 12_000 // ~a full resume; capped so it can't blow the prompt budget
const MAX_JD = 8_000

export type CandidateProfile = { resume: string; jd: string }

const EMPTY_PROFILE: CandidateProfile = { resume: '', jd: '' }

function parseProfile(raw: string): CandidateProfile {
  const p = JSON.parse(raw) as Partial<CandidateProfile> | null
  return {
    resume: typeof p?.resume === 'string' ? p.resume.slice(0, MAX_RESUME) : '',
    jd: typeof p?.jd === 'string' ? p.jd.slice(0, MAX_JD) : '',
  }
}

export function useCandidateProfile() {
  const { value: { resume, jd }, setValue, clear: clearStored } = useStoredPreference(KEY, EMPTY_PROFILE, parseProfile)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const setResume = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_RESUME)
      const saved = setValue((current) => ({ ...current, resume: capped }))
      setSavedNote(saved ? null : 'Too large to save — it won’t survive a reload.')
    },
    [setValue],
  )

  const setJd = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_JD)
      const saved = setValue((current) => ({ ...current, jd: capped }))
      setSavedNote(saved ? null : 'Too large to save — it won’t survive a reload.')
    },
    [setValue],
  )

  const clear = useCallback(() => {
    const saved = clearStored()
    setSavedNote(saved ? null : 'Could not clear saved profile — it may return after a reload.')
  }, [clearStored])

  // The always-injected context block for a prompt, or null if nothing set. Labeled
  // so the model treats it as the candidate's real background (ground answers in it,
  // don't invent beyond it) rather than as transcript content.
  const contextBlock = useCallback((): string | null => {
    const parts: string[] = []
    if (resume.trim()) parts.push(`CANDIDATE RESUME:\n${resume.trim()}`)
    if (jd.trim()) parts.push(`TARGET JOB DESCRIPTION:\n${jd.trim()}`)
    return parts.length ? parts.join('\n\n') : null
  }, [resume, jd])

  return { resume, jd, savedNote, hasProfile: !!(resume.trim() || jd.trim()), setResume, setJd, clear, contextBlock }
}
