// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const stubs = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), mic: vi.fn() }))
vi.mock('@/lib/interview/useInterviewRecorder', () => ({
  useInterviewRecorder: () => ({ start: stubs.start, stop: stubs.stop, getSegments: () => [], segments: [], phase: 'idle', error: null }),
  liveTranscript: () => '',
}))
vi.mock('@/lib/transcription/useKeytermPrefs', () => ({ useKeytermPrefs: () => ({ keyterms: [] }) }))
vi.mock('@/lib/interview/TuningContext', () => ({ useInterviewTuning: () => ({ state: { active: { revision: 1, instructions: '' } } }) }))
vi.mock('./LiveAnswerCanvas', () => ({ LiveAnswerCanvas: () => <div>Answer canvas</div> }))
import { LiveInterview } from './LiveInterview'
beforeEach(() => { stubs.start.mockReset(); stubs.stop.mockReset().mockResolvedValue([]) })
afterEach(cleanup)
function start() { fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Start interview' })) }
describe('live startup lifecycle', () => {
  it('ignores an old permission rejection after a newer session starts', async () => {
    let rejectOld!: (error: Error) => void
    stubs.start.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
      .mockResolvedValue(undefined)
    render(<LiveInterview visible blocked={false} onActivity={vi.fn()} onComplete={vi.fn()} />)
    start()
    fireEvent.click(screen.getByRole('button', { name: 'End' }))
    await screen.findByRole('button', { name: 'Start interview' })
    fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    await waitFor(() => expect(stubs.start).toHaveBeenCalledTimes(3))
    const stops = stubs.stop.mock.calls.length
    await act(async () => rejectOld(new Error('Old permission rejected')))
    expect(stubs.stop).toHaveBeenCalledTimes(stops)
    expect(screen.queryByText('Old permission rejected')).toBeNull()
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy()
  })
  it('does not start the second audio channel after a cancelled permission resolves', async () => {
    let resolveOld!: () => void
    stubs.start.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOld = resolve }))
    render(<LiveInterview visible blocked={false} onActivity={vi.fn()} onComplete={vi.fn()} />)
    start()
    fireEvent.click(screen.getByRole('button', { name: 'End' }))
    await screen.findByRole('button', { name: 'Start interview' })
    await act(async () => resolveOld())
    expect(stubs.start).toHaveBeenCalledTimes(1)
  })
  it('returns to setup with an actionable error when initial capture fails', async () => {
    stubs.start.mockRejectedValue(new Error('Microphone access denied'))
    const activity = vi.fn()
    render(<LiveInterview visible blocked={false} onActivity={activity} onComplete={vi.fn()} />)
    start()
    await screen.findByRole('button', { name: 'Start interview' })
    expect(screen.getByRole('alert').textContent).toContain('Microphone access denied')
    expect(activity).toHaveBeenLastCalledWith(false)
  })
})
