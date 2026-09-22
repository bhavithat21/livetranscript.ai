'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRepoIndex, createRepoFile, extractQuestions, isIndexablePath, MAX_QUESTIONS, mergeQuestionLedger, normalizeQuestion, rankRepoFiles, repoContext } from './index'
import type { InterviewQuestion, RepoIndex, RepoSourceFile } from './types'

const STORAGE_KEY = 'lt.repoInterview.questions.v1'
const MAX_SOURCE_CHARS = 8_000_000
const MAX_SOURCE_FILES = 2_000
const MAX_FILE_CHARS = 120_000

export function readStoredQuestions(raw: string | null): InterviewQuestion[] {
  try {
    if (!raw || raw.length > 1_000_000) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    return parsed.slice(-MAX_QUESTIONS).flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'string' || !row.id || row.id.length > 100 || seen.has(row.id)
        || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2_000
        || typeof row.capturedAt !== 'number' || !Number.isFinite(row.capturedAt)
        || !['captured', 'answering', 'answered', 'failed'].includes(String(row.status))) return []
      seen.add(row.id)
      return [{
        id: row.id,
        text: row.text,
        normalized: normalizeQuestion(row.text),
        capturedAt: row.capturedAt,
        updatedAt: typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) && row.updatedAt >= row.capturedAt
          ? row.updatedAt : row.capturedAt,
        // Interrupted requests must be answerable again after a reload.
        status: row.status === 'answering' ? 'captured' : row.status as InterviewQuestion['status'],
        ...(typeof row.sourceStart === 'number' && Number.isSafeInteger(row.sourceStart) && row.sourceStart >= 0
          ? { sourceStart: row.sourceStart } : {}),
        ...(typeof row.sourceOrder === 'number' && Number.isSafeInteger(row.sourceOrder) && row.sourceOrder >= 0
          ? { sourceOrder: row.sourceOrder } : {}),
      }]
    })
  } catch { return [] }
}

export function useRepoInterview(getTranscript: () => string, active: boolean) {
  const [index, setIndex] = useState<RepoIndex | null>(null)
  // Both server and first browser render are empty. Restore only after hydration,
  // and do not overwrite persisted data with the initial empty render.
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transcriptRef = useRef(getTranscript)
  const baselineRef = useRef('')
  const baselineQuestionCountRef = useRef(0)
  const importGeneration = useRef(0)
  useEffect(() => { transcriptRef.current = getTranscript }, [getTranscript])

  useEffect(() => {
    let mounted = true
    // The microtask also avoids nested synchronous renders in the hydration pass.
    queueMicrotask(() => {
      if (!mounted) return
      try { setQuestions(readStoredQuestions(localStorage.getItem(STORAGE_KEY))) } catch { /* storage unavailable */ }
      setHydrated(true)
    })
    return () => { mounted = false; importGeneration.current += 1 }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(questions)) } catch { /* session still works */ }
  }, [hydrated, questions])

  useEffect(() => {
    if (!active || !hydrated) return
    const collect = () => {
      const transcript = transcriptRef.current()
      const baseline = baselineRef.current
      let skipQuestions = baselineQuestionCountRef.current
      if (baseline && !transcript.startsWith(baseline)) {
        let shared = 0
        while (shared < Math.min(transcript.length, baseline.length) && transcript[shared] === baseline[shared]) shared += 1
        // Keep a question-count baseline across ASR length corrections. Character
        // slicing could otherwise cut the first new question in half after clear.
        // A newly started transcript with no meaningful prefix resets the baseline.
        if (shared < Math.min(12, baseline.length / 3)) {
          baselineRef.current = ''
          baselineQuestionCountRef.current = 0
          skipQuestions = 0
        }
      }
      setQuestions((current) => mergeQuestionLedger(current, transcript, skipQuestions))
    }
    collect()
    const timer = window.setInterval(collect, 900)
    return () => window.clearInterval(timer)
  }, [active, hydrated])

  const loadFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    const generation = ++importGeneration.current
    setLoading(true)
    setError(null)
    try {
      const source: RepoSourceFile[] = []
      let totalChars = 0
      for (const file of Array.from(files)) {
        if (generation !== importGeneration.current) return
        if (source.length >= MAX_SOURCE_FILES || totalChars >= MAX_SOURCE_CHARS) break
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        // Filter before reading, so dependencies and secrets never enter memory.
        if (!isIndexablePath(path) || file.size > 1_000_000) continue
        try {
          const content = (await file.text()).slice(0, Math.min(MAX_FILE_CHARS, MAX_SOURCE_CHARS - totalChars))
          if (content.includes('\0')) continue
          source.push(createRepoFile(path, content))
          totalChars += content.length
        } catch { /* skip unreadable/binary */ }
      }
      if (generation !== importGeneration.current) return
      const name = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || 'Repository').split('/')[0]
      const next = buildRepoIndex(name, source)
      if (!next.files.length) throw new Error('No supported source files found in that folder')
      setIndex(next)
    } catch (e) {
      if (generation === importGeneration.current) setError(e instanceof Error ? e.message : 'Could not index repository')
    } finally {
      if (generation === importGeneration.current) setLoading(false)
    }
  }, [])

  // An explicitly selected question stays pinned while new questions arrive.
  // Without an explicit selection, follow the most recently captured question.
  const selected = questions.find((question) => question.id === selectedId) ?? questions.at(-1) ?? null
  const effectiveSelectedId = selected?.id ?? null
  const matches = useMemo(() => rankRepoFiles(index, selected?.text ?? '', 5), [index, selected?.text])
  const contextFor = useCallback((question: string) => repoContext(index, question), [index])
  const mark = useCallback((id: string, status: InterviewQuestion['status'], expectedText?: string) => {
    setQuestions((current) => current.map((question) => question.id === id
      && (expectedText === undefined || question.normalized === normalizeQuestion(expectedText)) ? { ...question, status } : question))
  }, [])
  const clearQuestions = useCallback(() => {
    baselineRef.current = transcriptRef.current()
    baselineQuestionCountRef.current = extractQuestions(baselineRef.current).length
    setQuestions([])
    setSelectedId(null)
  }, [])

  return { index, questions, selected, selectedId: effectiveSelectedId, matches, loading, error, loadFiles, setSelectedId, contextFor, mark, clearQuestions, hydrated }
}
