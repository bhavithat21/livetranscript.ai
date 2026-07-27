import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOrchestrationRouter } from './useOrchestrationRouter'

// The router must be FAIL-SOFT: any classify/search error → nulls, so the caller
// keeps its current mode and skips web. And it must only web-search when the
// classification says needsWeb. We stub fetch per-endpoint to assert the wiring.
function stub(handler: (url: string, body: unknown) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      const out = handler(url, body)
      if (out === 'error') return { ok: false, json: async () => ({}) } as unknown as Response
      return { ok: true, json: async () => out } as unknown as Response
    }),
  )
}
afterEach(() => vi.unstubAllGlobals())

describe('useOrchestrationRouter.route', () => {
  it('classifies, and web-searches ONLY when needsWeb is true', async () => {
    const calls: string[] = []
    stub((url) => {
      calls.push(url)
      if (url.includes('/classify')) return { result: { isQuestion: true, mode: 'general', needsWeb: true, confidence: 0.9 } }
      if (url.includes('/websearch')) return { result: 'React 19.2 is current. Sources: react.dev' }
      return {}
    })
    const { result } = renderHook(() => useOrchestrationRouter())
    const r = await result.current.route('latest react version?')
    expect(r.classification?.mode).toBe('general')
    expect(r.webContext).toContain('React 19.2')
    expect(calls.some((u) => u.includes('/websearch'))).toBe(true)
  })

  it('does NOT web-search when needsWeb is false', async () => {
    const calls: string[] = []
    stub((url) => {
      calls.push(url)
      if (url.includes('/classify')) return { result: { isQuestion: true, mode: 'coding', needsWeb: false, confidence: 1 } }
      return {}
    })
    const { result } = renderHook(() => useOrchestrationRouter())
    const r = await result.current.route('reverse a linked list')
    expect(r.classification?.mode).toBe('coding')
    expect(r.webContext).toBeNull()
    expect(calls.some((u) => u.includes('/websearch'))).toBe(false)
  })

  it('fails soft: a classify error yields null classification (caller keeps its mode)', async () => {
    stub((url) => (url.includes('/classify') ? 'error' : {}))
    const { result } = renderHook(() => useOrchestrationRouter())
    const r = await result.current.route('anything')
    expect(r.classification).toBeNull()
    expect(r.webContext).toBeNull()
  })

  it('rejects an invalid mode from the classifier (guards against a bad payload)', async () => {
    stub((url) => (url.includes('/classify') ? { result: { isQuestion: true, mode: 'nonsense', needsWeb: false, confidence: 1 } } : {}))
    const { result } = renderHook(() => useOrchestrationRouter())
    const r = await result.current.route('q')
    expect(r.classification).toBeNull() // invalid mode → treated as no classification
  })
})
