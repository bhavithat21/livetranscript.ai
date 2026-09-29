// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const stubs = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), mic: vi.fn(), native: false, maximize: vi.fn() }))
vi.mock('@/lib/desktop/overlay', () => ({ nativeDesktopAvailable: () => stubs.native, maximizeLiveInterviewWindow: stubs.maximize }))
vi.mock('@/components/coach/OverlayWorkspace', () => ({ OverlayWorkspace: ({ controls, next, say, code }: { controls: React.ReactNode; next: React.ReactNode; say: React.ReactNode; code: React.ReactNode }) => <div>{controls}<section aria-label="What to do next">{next}</section><section aria-label="What to say">{say}</section><section aria-label="What to write">{code}</section></div> }))
vi.mock('@/lib/interview/useInterviewRecorder', () => ({
  useInterviewRecorder: () => ({ start: stubs.start, stop: stubs.stop, getSegments: () => [], segments: [], phase: 'idle', error: null }),
  liveTranscript: () => '',
}))
vi.mock('@/lib/transcription/useKeytermPrefs', () => ({ useKeytermPrefs: () => ({ keyterms: [] }) }))
vi.mock('@/lib/interview/TuningContext', () => ({ useInterviewTuning: () => ({ state: { active: { revision: 1, instructions: '' } } }) }))
vi.mock('./LiveAnswerCanvas', () => ({ LiveAnswerCanvas: () => <div>Answer canvas</div> }))
vi.mock('@/components/coach/RepositoryCoach', () => ({ RepositoryCoach: () => <div>Shared repository coach</div> }))
import { LiveInterview } from './LiveInterview'
beforeEach(() => { stubs.native = false; stubs.maximize.mockReset().mockResolvedValue(true); stubs.start.mockReset(); stubs.stop.mockReset().mockResolvedValue([]) })
afterEach(cleanup)
function start() { fireEvent.click(screen.getByRole('checkbox', { name: /I have permission to record/ })); fireEvent.click(screen.getByRole('button', { name: 'Start interview' })) }
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
  it('keeps the interview open with an actionable error when audio permission fails', async () => {
    stubs.start.mockRejectedValue(new Error('Microphone access denied'))
    const activity = vi.fn()
    render(<LiveInterview visible blocked={false} onActivity={activity} onComplete={vi.fn()} />)
    start()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Microphone access denied'))
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Microphone access denied')
    expect(activity).toHaveBeenLastCalledWith(true)
  })
})
it('mounts the shared repository coach only when selected before starting', async () => {
  stubs.start.mockResolvedValue(undefined)
  render(<LiveInterview visible blocked={false} onActivity={vi.fn()} onComplete={vi.fn()} />)
  fireEvent.click(screen.getByRole('checkbox', { name: /Repository coding interview/ }))
  start()
  expect(await screen.findByText('Shared repository coach')).toBeTruthy()
  expect(screen.queryByText('Answer canvas')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByRole('button', { name: 'Start interview' })
  expect(screen.queryByText('Shared repository coach')).toBeNull()
})

it('opens a simple desktop start page and maximizes only on explicit Start', async () => {
  stubs.native = true
  stubs.start.mockResolvedValue(undefined)
  const view = render(<LiveInterview visible blocked={false} onActivity={vi.fn()} onComplete={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Start your interview' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'What to say' })).toBeNull()
  expect(stubs.start).not.toHaveBeenCalled()
  expect(stubs.maximize).not.toHaveBeenCalled()
  start()
  expect(await screen.findByText('Shared repository coach')).toBeTruthy()
  expect(stubs.maximize).toHaveBeenCalledTimes(1)
  view.rerender(<LiveInterview visible blocked={false} onActivity={vi.fn()} onComplete={vi.fn()} />)
  expect(stubs.maximize).toHaveBeenCalledTimes(1)
})

it('can start screen-only coaching without requesting either audio channel', async () => {
  stubs.native = true
  render(<LiveInterview visible blocked={false} onActivity={vi.fn()} onComplete={vi.fn()} />)
  fireEvent.change(screen.getByRole('combobox', { hidden: true }), { target: { value: 'screen' } })
  start()
  expect(await screen.findByText('Shared repository coach')).toBeTruthy()
  expect(stubs.start).not.toHaveBeenCalled()
})
