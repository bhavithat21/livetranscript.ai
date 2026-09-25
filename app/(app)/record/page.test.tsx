import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { TranscriptEvent } from '@/lib/transcription/types'
const mocks = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), nativeStart: vi.fn(), nativeStop: vi.fn(), connect: vi.fn(), save: vi.fn(), fetch: vi.fn(),
  final: null as null | ((event: TranscriptEvent) => void), partial: null as null | ((event: TranscriptEvent) => void),
}))
vi.mock('@/lib/audio/useMicStream', () => ({ useMicStream: () => ({ start: mocks.start, stop: mocks.stop, error: null }) }))
vi.mock('@/lib/audio/useNativeCapture', () => ({ isTauri: () => false, useNativeCapture: () => ({ start: mocks.nativeStart, stop: mocks.nativeStop }) }))
vi.mock('@/lib/transcription', () => ({ connectWithFallback: mocks.connect }))
vi.mock('./actions', () => ({ saveSession: mocks.save }))
vi.mock('../session-actions', () => ({ createShare: vi.fn() }))
vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => null }))
vi.mock('@/components/copilot/CopilotPanel', () => ({ CopilotPanel: () => null }))
vi.mock('@/components/ui/ShortcutHelp', () => ({ ShortcutHelp: () => null, MOD: 'Ctrl' }))
import RecordPage from './page'
const final = (text: string, start: number): TranscriptEvent => ({ text, startMs: start, endMs: start + 500, speaker: 0, isFinal: true })
const provider = {
  onPartial: vi.fn((cb: (event: TranscriptEvent) => void) => { mocks.partial = cb }),
  onFinal: vi.fn((cb: (event: TranscriptEvent) => void) => { mocks.final = cb }),
  sendAudio: vi.fn(), onStatus: vi.fn(), disconnect: vi.fn(),
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.final = null; mocks.partial = null
  mocks.start.mockImplementation(async (onPcm: (pcm: ArrayBuffer) => void) => { onPcm(new ArrayBuffer(8)); return 16000 })
  mocks.nativeStart.mockResolvedValue(0); mocks.nativeStop.mockResolvedValue(undefined)
  mocks.connect.mockResolvedValue({ provider, name: 'Deepgram' })
  mocks.save.mockResolvedValue({ id: 'fixture-session' })
  mocks.fetch.mockResolvedValue({ ok: false })
  provider.sendAudio.mockImplementation(() => { mocks.final?.(final('Opening statement.', 0)) })
  provider.disconnect.mockImplementation(async () => { mocks.final?.(final('Trailing first.', 1000)); mocks.final?.(final('Trailing last.', 2000)) })
  vi.stubGlobal('fetch', mocks.fetch)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('recording fidelity', () => {
  it('registers transcript callbacks before draining audio; saves every trailing final unchanged', async () => {
    const { getByRole, getByText } = render(<StrictMode><RecordPage /></StrictMode>)
    fireEvent.click(getByRole('button', { name: 'Start recording' }))
    await waitFor(() => expect(getByText('Opening statement.')).toBeTruthy())
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    const saved = mocks.save.mock.calls[0][0].segments
    expect(saved.map((segment: { text: string }) => segment.text)).toEqual(['Opening statement.', 'Trailing first.', 'Trailing last.'])
    expect(mocks.fetch.mock.calls.map(call => call[0])).toEqual(['/api/summarize'])
  })
  it('saves the source transcript even when optional summary generation fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))
    const { getByRole } = render(<RecordPage />)
    fireEvent.click(getByRole('button', { name: 'Start recording' }))
    await waitFor(() => expect(getByRole('button', { name: 'Stop' })).toBeTruthy())
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    expect(mocks.save.mock.calls[0][0].summary).toBeNull()
    expect(mocks.save.mock.calls[0][0].segments).toHaveLength(3)
  })
  it('cancels a pending provider connection on unmount', async () => {
    let signal: AbortSignal | undefined
    mocks.connect.mockImplementation((config: { signal: AbortSignal }) => {
      signal = config.signal
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason)))
    })
    const { getByRole, unmount } = render(<RecordPage />)
    fireEvent.click(getByRole('button', { name: 'Start recording' }))
    await waitFor(() => expect(signal).toBeTruthy())
    await act(async () => { unmount() })
    expect(signal!.aborted).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
