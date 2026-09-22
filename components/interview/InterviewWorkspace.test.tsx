// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewTurn } from '@/lib/interview/model'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), start: vi.fn(), stop: vi.fn(), save: vi.fn(), sink: null as null | ((turn: InterviewTurn) => void) }))
vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <div>Navigation</div> }))
vi.mock('@/components/copilot/CopilotPanel', () => ({ CopilotPanel: () => <div>Optional copilot</div> }))
vi.mock('@/lib/copilot/usePanelWidth', () => ({ usePanelWidth: () => ({ width: 384, onResizeStart: vi.fn() }) }))
vi.mock('@/lib/copilot/useCandidateProfile', () => ({ useCandidateProfile: () => ({ hasProfile: false, contextBlock: () => null }) }))
vi.mock('@/app/(app)/record/actions', () => ({ saveSession: mocks.save }))
vi.mock('@/lib/interview/useInterviewCapture', () => ({ useInterviewCapture: (sink: (turn: InterviewTurn) => void) => {
  mocks.sink = sink
  return { start: mocks.start, stop: mocks.stop, status: 'idle', error: null, partial: { candidate: '', interviewer: '' }, levels: { candidate: 0, interviewer: 0 } }
} }))
import { InterviewWorkspace } from './InterviewWorkspace'
const response = (question: string) => ({ ok: true, json: async () => ({ question }) })

beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue(response('Describe a difficult technical decision.'))
  mocks.start.mockReset().mockResolvedValue(true)
  mocks.stop.mockReset().mockResolvedValue(undefined)
  mocks.save.mockReset().mockResolvedValue({ id: 'saved-interview' })
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function startMock() {
  render(<InterviewWorkspace />)
  fireEvent.click(screen.getByRole('radio', { name: /Mock interview/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Start mock interview' }))
  await screen.findByRole('heading', { name: 'Describe a difficult technical decision.' })
}

describe('interview studio flow', () => {
  it('does not capture live audio until recording permission is confirmed', async () => {
    render(<InterviewWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Start live interview' }))
    expect(screen.getByRole('alert').textContent).toContain('Confirm recording permission')
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('includes a typed answer before requesting the next mock question', async () => {
    await startMock()
    mocks.fetch.mockResolvedValue(response('How did you verify the outcome?'))
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I rolled back the change and verified the queue drained.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish answer & next question' }))
    await screen.findByRole('heading', { name: 'How did you verify the outcome?' })
    const sent = JSON.parse(mocks.fetch.mock.calls[1][1].body)
    expect(sent.turns.at(-1).role).toBe('candidate')
    expect(sent.turns.at(-1).text).toContain('queue drained')
  })
  it('drains final audio before review and saves candidate attribution', async () => {
    await startMock()
    mocks.stop.mockImplementation(async () => {
      mocks.sink?.({ id: 'final-answer', role: 'candidate', text: 'I verified the queue drained after the rollback.', atMs: 5000, source: 'microphone' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'End interview' }))
    await screen.findByRole('button', { name: 'Generate interview feedback' })
    expect(screen.getByText('I verified the queue drained after the rollback.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to Library' }))
    await screen.findByRole('button', { name: 'Saved to Library' })
    expect(mocks.save.mock.calls[0][0].segments.at(-1).name).toBe('Candidate')
  })
  it('ignores a question response arriving after the interview has ended', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void
    mocks.fetch.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<InterviewWorkspace />)
    fireEvent.click(screen.getByRole('radio', { name: /Mock interview/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start mock interview' }))
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'End interview' }))
    await screen.findByRole('button', { name: 'Generate interview feedback' })
    await act(async () => { resolve(response('Late question that must not appear.')) })
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText('Late question that must not appear.')).toBeNull()
  })
})
