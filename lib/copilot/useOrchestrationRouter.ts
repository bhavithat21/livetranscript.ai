'use client'
import { useCallback, useRef } from 'react'
import type { CopilotMode } from './modes'
import { localClassify } from './localClassify'

// The orchestrator's routing brain (client side). For a heard/typed question it
// asks the classifier route to decide: is this a real question, which MODE it is,
// and whether it needs LIVE web facts. When web is needed it fetches a grounded
// snippet from the websearch route. Both are fail-soft — any error returns nulls so
// the caller keeps its current mode and skips web, never blocking an answer.
//
// This is what turns the manual mode chip into auto-routing: the panel calls route()
// on a detected question, switches the tab to the returned mode, and passes any web
// context into the answer.

export type Classification = {
  isQuestion: boolean
  mode: CopilotMode
  needsWeb: boolean
  confidence: number
}

export type RouteResult = {
  classification: Classification | null
  webContext: string | null
}

const VALID: CopilotMode[] = ['general', 'coding', 'systemDesign', 'behavioral']

export function useOrchestrationRouter() {
  // Guard against overlapping route() calls stacking classifier requests.
  const inFlight = useRef(false)

  const classify = useCallback(async (question: string): Promise<Classification | null> => {
    try {
      const res = await fetch('/api/copilot/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) return null
      const { result } = await res.json()
      if (!result || !VALID.includes(result.mode)) return null
      return result as Classification
    } catch {
      return null
    }
  }, [])

  const webSearch = useCallback(async (query: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/copilot/websearch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) return null
      const { result } = await res.json()
      return typeof result === 'string' && result.trim() ? result : null
    } catch {
      return null
    }
  }, [])

  // Classify a question, then fetch web context IF it needs current facts. Returns
  // both so the caller can auto-switch mode and ground the answer. `route` runs the
  // two hops in the right order (classify first — web only when needsWeb).
  const route = useCallback(
    async (question: string): Promise<RouteResult> => {
      if (inFlight.current) return { classification: null, webContext: null }
      inFlight.current = true
      try {
        // LOCAL-FIRST: an unambiguous question is classified with zero network latency
        // (the common case), so the classifier round-trip is OFF the hot path. Only an
        // AMBIGUOUS question (local returns null) escalates to the LLM classifier.
        const local = localClassify(question)
        const classification: Classification | null = local
          ? { ...local, confidence: 1 }
          : await classify(question)
        // Web search still runs when needed — but the freshness signal is cheap to
        // detect locally, so it usually starts without waiting on the LLM classifier.
        const webContext = classification?.needsWeb ? await webSearch(question) : null
        return { classification, webContext }
      } finally {
        inFlight.current = false
      }
    },
    [classify, webSearch],
  )

  return { route, classify, webSearch }
}
