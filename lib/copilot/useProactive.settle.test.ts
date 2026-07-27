import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useProactive } from './useProactive'

// The completion gate: answer IMMEDIATELY when the question looks complete (ASR
// terminal punctuation = speaker finished → zero added latency), and only wait when
// the text is still forming (no punctuation yet) so we never answer a fragment.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('fires IMMEDIATELY (no settle wait) for a punctuation-terminated question', () => {
  let transcript = ''
  const onQ = vi.fn()
  renderHook(() => useProactive(true, () => transcript, onQ))
  transcript = 'Tell me about a time you led a hard migration.'
  vi.advanceTimersByTime(600) // one poll — complete, so it fires now (no extra wait)
  expect(onQ).toHaveBeenCalledTimes(1)
  expect(onQ.mock.calls[0][0]).toContain('hard migration')
})

it('fires a ?-terminated question on the first poll', () => {
  let transcript = ''
  const onQ = vi.fn()
  renderHook(() => useProactive(true, () => transcript, onQ))
  transcript = 'What is your biggest weakness?'
  vi.advanceTimersByTime(600)
  expect(onQ).toHaveBeenCalledTimes(1)
})

it('does NOT fire an unpunctuated fragment immediately; waits for the settle backstop', () => {
  let transcript = ''
  const onQ = vi.fn()
  renderHook(() => useProactive(true, () => transcript, onQ))
  // No terminal punctuation → still forming → must wait, not answer the fragment.
  transcript = 'tell me how would you design'
  vi.advanceTimersByTime(600) // first poll: starts the settle clock, does not fire
  expect(onQ).not.toHaveBeenCalled()
  // Advance well past the 900ms backstop (polls are 600ms apart) → now it answers.
  vi.advanceTimersByTime(1800)
  expect(onQ).toHaveBeenCalledTimes(1)
})

it('does not re-answer a question already answered (dedupe holds)', () => {
  let transcript = ''
  const onQ = vi.fn()
  renderHook(() => useProactive(true, () => transcript, onQ))
  transcript = 'Reverse a linked list.'
  vi.advanceTimersByTime(600)
  vi.advanceTimersByTime(600)
  expect(onQ).toHaveBeenCalledTimes(1) // fired once, not again on the next poll
})
