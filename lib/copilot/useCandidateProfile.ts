'use client'
import { useCallback, useEffect, useState } from 'react'

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

function load(): CandidateProfile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { resume: '', jd: '' }
    const p = JSON.parse(raw) as Partial<CandidateProfile>
    return { resume: p.resume ?? '', jd: p.jd ?? '' }
  } catch {
    return { resume: '', jd: '' }
  }
}

export function useCandidateProfile() {
  const [resume, setResumeState] = useState('')
  const [jd, setJdState] = useState('')
  const [savedNote, setSavedNote] = useState<string | null>(null)

  useEffect(() => {
    const p = load()
    setResumeState(p.resume)
    setJdState(p.jd)
  }, [])

  const persist = useCallback((next: CandidateProfile) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      setSavedNote(null)
    } catch {
      // Resume + JD are small vs embeddings, but be honest if it somehow fails.
      setSavedNote('Too large to save — it won’t survive a reload.')
    }
  }, [])

  const setResume = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_RESUME)
      setResumeState(capped)
      persist({ resume: capped, jd })
    },
    [jd, persist],
  )

  const setJd = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_JD)
      setJdState(capped)
      persist({ resume, jd: capped })
    },
    [resume, persist],
  )

  const clear = useCallback(() => {
    setResumeState('')
    setJdState('')
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }, [])

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
