import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useProactive } from './useProactive'

// The SETTLE gate: proactive auto-answer must wait for a spoken question to FINISH
// (stop growing) before answering, so it never answers a half-spoken fragment.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('does NOT fire while the question is still growing; fires once it settles', () => {
  let transcript = ''
  const onQ = vi.fn()
  renderHook(() => useProactive(true, () => transcript, onQ))

  transcript = 'Tell me about a time you'
  vi.advanceTimersByTime(600)
  transcript = 'Tell me about a time you led a'
  vi.advanceTimersByTime(600)
  transcript = 'Tell me about a time you led a hard migration.'
  vi.advanceTimersByTime(600)
  expect(onQ).not.toHaveBeenCalled() // still growing → no fragment answered

  vi.advanceTimersByTime(1400) // now stable past the settle window
  expect(onQ).toHaveBeenCalledTimes(1)
  expect(onQ.mock.calls[0][0]).toContain('hard migration')
})

it('fires a ?-terminated question faster (short settle)', () => {
  let transcript = ''
  const onQ = vi.fn()
  renderHook(() => useProactive(true, () => transcript, onQ))
  transcript = 'What is your biggest weakness?'
  vi.advanceTimersByTime(600)
  vi.advanceTimersByTime(600)
  expect(onQ).toHaveBeenCalledTimes(1)
})
