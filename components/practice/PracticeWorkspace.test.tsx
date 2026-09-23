import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Segment } from '@/lib/transcript/store'

const mocks = vi.hoisted(() => ({
  capture: { status: 'idle', error: null as string | null, segments: [] as Segment[], start: vi.fn(), stop: vi.fn(), clear: vi.fn() },
  speak: vi.fn(), cancel: vi.fn(),
}))
vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <a href="/library">Home</a> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme</span> }))
vi.mock('@/lib/copilot/useCopilotCapture', () => ({ useCopilotCapture: () => mocks.capture }))
vi.mock('@/lib/copilot/useCandidateProfile', () => ({ useCandidateProfile: () => ({ hasProfile: true, contextBlock: () => 'CANDIDATE RESUME:\nI built a billing service.' }) }))

import { PracticeWorkspace } from './PracticeWorkspace'

const first = { model: 'coach-model', question: 'Tell me about a risky change you led.', focus: 'Ownership' }
const makeFeedback = (quote: string) => ({ summary: 'A useful starting point; add the result.', rubric: [
  { criterion: 'Specificity', score: 4, evidence: quote, suggestion: 'Explain your choice.' },
  { criterion: 'Outcome', score: null, evidence: '', suggestion: 'Explain what happened.' },
], strength: 'A concrete action is present.', nextStep: 'Add the outcome.' })
async function begin() {
  fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
  await screen.findByRole('heading', { name: first.question })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.capture.status = 'idle'
  mocks.capture.error = null
  mocks.capture.segments = []
  mocks.capture.start.mockImplementation(async () => { mocks.capture.status = 'listening' })
  mocks.capture.stop.mockImplementation(() => { mocks.capture.status = 'idle' })
  mocks.capture.clear.mockImplementation(() => { mocks.capture.segments = []; mocks.capture.error = null })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(first)))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('candidate practice journey', () => {
  it('requires a role, keeps audio opt-in and includes saved profile only when selected', async () => {
    render(<PracticeWorkspace />)
    const role = screen.getByLabelText('Target role')
    fireEvent.change(role, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
    expect(document.activeElement).toBe(role)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.change(role, { target: { value: 'Staff engineer' } })
    fireEvent.click(screen.getByLabelText(/Use saved resume/))
    await begin()
    expect(mocks.capture.start).not.toHaveBeenCalled()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({ role: 'Staff engineer', context: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
    expect(screen.getByRole('alert').textContent).toContain('Type an answer')
    expect(document.activeElement).toBe(screen.getByLabelText('Your answer'))
  })
  it('uses the selected interview type for the practice request', async () => {
    render(<PracticeWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /^System design/ }))
    expect(screen.getByRole('button', { name: /^System design/ }).getAttribute('aria-pressed')).toBe('true')
    await begin()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).kind).toBe('systemDesign')
  })
  it('keeps a draft until discarding practice is explicitly confirmed', async () => {
    render(<PracticeWorkspace />)
    await begin()
    const draft = 'I prepared a rollback plan.'
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: draft } })
    const end = screen.getByRole('button', { name: 'End practice' })
    fireEvent.click(end)
    expect(screen.getByRole('group', { name: 'Confirm practice reset' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep practice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep practice' }))
    expect(document.activeElement).toBe(end)
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe(draft)
    fireEvent.click(end)
    fireEvent.click(screen.getByRole('button', { name: 'Discard practice' }))
    expect(screen.getByRole('form', { name: 'Practice setup' })).toBeTruthy()
    expect(screen.queryByLabelText('Your answer')).toBeNull()
    expect(mocks.capture.stop).toHaveBeenCalled()
  })
  it('retains the typed answer after failure and advances only after reviewed feedback', async () => {
    render(<PracticeWorkspace />)
    await begin()
    const input = screen.getByLabelText('Your answer')
    const answer = 'I planned a rollback before shipping.'
    fireEvent.change(input, { target: { value: answer } })
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Temporary model failure' }, { status: 502 }))
    fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
    await screen.findByText('Temporary model failure')
    expect((input as HTMLTextAreaElement).value).toBe(answer)
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ model: 'coach-model', question: 'What happened next?', focus: 'Results', feedback: makeFeedback('planned a rollback') }))
    fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
    await screen.findByRole('heading', { name: 'A closer look at your answer' })
    expect(screen.getByText('4/5 · AI estimate')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'What happened next?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    expect(await screen.findByRole('heading', { name: 'What happened next?' })).toBeTruthy()
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('')
  })
  it('requires stopping and reviewing dictation before submission, and measures only microphone time', async () => {
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const view = render(<PracticeWorkspace />)
    await begin()
    fireEvent.click(screen.getByRole('button', { name: 'Use microphone' }))
    await waitFor(() => expect(mocks.capture.start).toHaveBeenCalledWith('mic'))
    mocks.capture.segments = [{ id: 1, text: 'I planned rollback.', isFinal: true, speaker: 0 }]
    view.rerender(<PracticeWorkspace />)
    expect((screen.getByRole('button', { name: 'Get feedback' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).readOnly).toBe(true)
    now = 31_000
    fireEvent.click(screen.getByRole('button', { name: 'Stop and review' }))
    expect(mocks.capture.stop).toHaveBeenCalled()
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('I planned rollback.')
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I planned rollback. It succeeded.' } })
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ model: 'coach-model', question: 'How did you measure success?', focus: 'Results', feedback: makeFeedback('I planned rollback.') }))
    fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
    expect(await screen.findByText(/about 6 words\/min/)).toBeTruthy()
    expect(screen.getByText(/30.0 seconds of listening/)).toBeTruthy()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string).answer).toBe('I planned rollback. It succeeded.')
  })
  it('cancels question playback on microphone start and route navigation', async () => {
    vi.stubGlobal('speechSynthesis', { speak: mocks.speak, cancel: mocks.cancel })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    const { unmount } = render(<PracticeWorkspace />)
    await begin()
    fireEvent.click(screen.getByRole('button', { name: 'Read question aloud' }))
    expect(mocks.speak).toHaveBeenCalledTimes(1)
    const before = mocks.cancel.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Use microphone' }))
    await waitFor(() => expect(mocks.cancel.mock.calls.length).toBeGreaterThan(before))
    const afterMicrophone = mocks.cancel.mock.calls.length
    unmount()
    expect(mocks.cancel.mock.calls.length).toBeGreaterThan(afterMicrophone)
  })
  it('returns to an editable answer when microphone permission fails', async () => {
    mocks.capture.start.mockImplementation(async () => { mocks.capture.status = 'error'; mocks.capture.error = 'Microphone access was denied.' })
    render(<PracticeWorkspace />)
    await begin()
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'A draft I already typed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use microphone' }))
    await screen.findByText('Microphone access was denied.')
    await waitFor(() => expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).readOnly).toBe(false))
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('A draft I already typed.')
    expect((screen.getByRole('button', { name: 'Get feedback' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('shows an evidence-based session review without saving a fake history record', async () => {
    render(<PracticeWorkspace />)
    await begin()
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I tested rollback.' } })
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ model: 'coach-model', question: 'What changed?', focus: 'Results', feedback: makeFeedback('I tested rollback.') }))
    fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
    await screen.findByRole('button', { name: 'Finish and review' })
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ model: 'coach-model', report: { summary: 'Your answer named a risk-reduction action.', highlights: [{ turn: 1, quote: 'I tested rollback.', observation: 'Explain the result next time.' }], practiceNext: ['Rehearse a measured outcome.'] } }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish and review' }))
    await screen.findByRole('heading', { name: 'Your practice review' })
    expect(screen.getByText('Rehearse a measured outcome.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download review' })).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(Array(3).fill('/api/copilot/practice'))
  })
})
