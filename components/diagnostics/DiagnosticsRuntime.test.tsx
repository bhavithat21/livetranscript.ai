// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ record: vi.fn(), flush: vi.fn(), enable: vi.fn(), clear: vi.fn(), pathname: '/interview', state: { enabled: true, sessionId: '2b92d2b4-2299-441d-8999-5c9bef381803', events: [], pending: 0, dropped: 0, delivery: 'idle', lastSentAt: null } }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('@/lib/diagnostics/client', () => ({
  clearDiagnostics: mocks.clear, exportDiagnostics: () => '{}', flushDiagnostics: mocks.flush,
  getDiagnostics: () => mocks.state, getServerDiagnostics: () => mocks.state, initializeDiagnostics: vi.fn(),
  recordDiagnostic: mocks.record, setDiagnosticsEnabled: mocks.enable, subscribeDiagnostics: () => () => {},
}))
import { DiagnosticsRuntime } from './DiagnosticsRuntime'
beforeEach(() => {
  vi.clearAllMocks(); mocks.pathname = '/interview'; mocks.flush.mockResolvedValue(false)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(cleanup)
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }))
it('opens independently of a running interview and exposes the diagnostic session ID', () => {
  render(<DiagnosticsRuntime release="abcdef1234" />); open()
  expect(screen.getByRole('dialog', { name: 'Session diagnostics' })).toBeTruthy()
  expect(screen.getByText(mocks.state.sessionId)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('does not present queued or failed telemetry as delivered', async () => {
  render(<DiagnosticsRuntime />); open()
  fireEvent.click(screen.getByRole('button', { name: 'Test cloud logging' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No cloud receipt'))
  mocks.flush.mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Test cloud logging' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Cloud receipt confirmed'))
})
it('allows disabling and recording categorical feedback without collecting user content', () => {
  render(<DiagnosticsRuntime />); open()
  fireEvent.click(screen.getByRole('button', { name: 'Missing transcript' }))
  expect(mocks.record).toHaveBeenCalledWith('transcription', 'feedback', { verdict: 'needs-work', category: 'correctness' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Record and send metadata diagnostics' }))
  expect(mocks.enable).toHaveBeenCalledWith(false)
})
it('reduces unhandled errors to categories without copying their messages', () => {
  render(<DiagnosticsRuntime />)
  window.dispatchEvent(new ErrorEvent('error', { error: new Error('PRIVATE_SOURCE_OR_KEY'), message: 'PRIVATE_SOURCE_OR_KEY' }))
  expect(mocks.record).toHaveBeenLastCalledWith('app', 'error', { code: 'unknown' })
  expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('PRIVATE_SOURCE_OR_KEY')
})
it('does not start collection on unrelated pages', () => {
  mocks.pathname = '/pricing'; render(<DiagnosticsRuntime />)
  expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull()
  expect(mocks.record).not.toHaveBeenCalled()
})
