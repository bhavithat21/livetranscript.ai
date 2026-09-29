// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { RetryStatus } from './RetryStatus'
import { retryDisplay } from '@/lib/coach/retryStatus'
afterEach(cleanup)
it('shows retry progress without enabling diagnostics and clears on completion', () => {
  const display = retryDisplay('screen_model')
  render(<RetryStatus />)
  expect(screen.queryByRole('status')).toBeNull()
  act(() => display.retry({ attempt: 2, maxAttempts: 3, delayMs: 500 }))
  expect(screen.getByRole('status').textContent).toContain('Screen analysis: retrying · attempt 2 of 3')
  act(() => display.finish())
  expect(screen.queryByRole('status')).toBeNull()
})
it('keeps concurrent retries independent', () => {
  const one = retryDisplay('talk'), two = retryDisplay('guide')
  render(<RetryStatus />)
  act(() => { one.retry({ attempt: 2, maxAttempts: 3, delayMs: 500 }); two.retry({ attempt: 3, maxAttempts: 3, delayMs: 1000 }) })
  act(() => one.finish())
  expect(screen.getByRole('status').textContent).toContain('Code guidance')
  expect(screen.getByRole('status').textContent).not.toContain('Spoken guidance')
  act(() => two.finish())
})
