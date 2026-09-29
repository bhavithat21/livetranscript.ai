import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ReadinessPanel } from './ReadinessPanel'
import { clearDiagnostics, recordDiagnostic, setDiagnosticsEnabled } from '@/lib/diagnostics/client'
beforeEach(() => { clearDiagnostics(); setDiagnosticsEnabled(true) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); clearDiagnostics() })
it('rejects an empty passed report instead of claiming model readiness', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, scope: 'synthetic-server-probes', deviceVerified: false, passed: true, checks: [] })))
  render(<ReadinessPanel />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check model and transcription access' })))
  expect(screen.getByRole('alert').textContent).toContain('Invalid readiness report')
  expect(screen.queryByText('Synthetic server checks passed.', { exact: false })).toBeNull()
})
it('shows a timeout instead of silently discarding a failed provider check', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))))
  render(<ReadinessPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Check model and transcription access' }))
  await act(async () => vi.advanceTimersByTimeAsync(55_100))
  expect(screen.getByRole('alert').textContent).toContain('timed out')
})
it('retains observed device milestones after raw ring-buffer rotation but clears them on session reset', async () => {
  render(<ReadinessPanel />)
  fireEvent.click(screen.getByRole('checkbox', { name: /This is a mock session/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Begin a new device checklist' }))
  await act(async () => recordDiagnostic('audio', 'first_frame', { channel: 'mic' }))
  expect(screen.getByText('Observed — Microphone PCM received')).toBeTruthy()
  await act(async () => { for (let i = 0; i < 610; i++) recordDiagnostic('app', 'heartbeat', { count: i }) })
  expect(screen.getByText('Observed — Microphone PCM received')).toBeTruthy()
  await act(async () => clearDiagnostics())
  expect(screen.getByText('Not yet observed — Microphone PCM received')).toBeTruthy()
})
