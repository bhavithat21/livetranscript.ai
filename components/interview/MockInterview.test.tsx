// @vitest-environment jsdom
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { CopilotCalibrationContext, InterviewTuningProvider } from '@/lib/interview/TuningContext'
vi.mock('@/lib/copilot/latency', () => ({ captureLatency: vi.fn() }))
vi.mock('@/components/copilot/Markdown', () => ({ Markdown: ({ children }: { children: string }) => <pre>{children}</pre> }))
vi.mock('@/components/copilot/CopilotPanel', () => ({ CopilotPanel: ({ getTranscript }: { getTranscript: () => string }) => {
  const copilot = useCopilot(getTranscript)
  return <button onClick={() => void copilot.ask('How should the limiter work?', 'coding', null, 'Existing grounding', 'Existing mode preferences')}>Generate test answer</button>
} }))
const recorderStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/interview/useInterviewRecorder', () => ({ useInterviewRecorder: () => ({ start: vi.fn(), stop: recorderStop, getSegments: () => [], phase: 'idle', segments: [], error: null }), captureText: () => '' }))
import { MockInterview } from './MockInterview'
const fetcher = vi.fn()
function LiveProbe() { const value = useContext(CopilotCalibrationContext); return <output data-testid="live-profile">{value?.revision}:{value?.instructions}</output> }
function mount(blocked = false) {
  const complete = vi.fn()
  render(<InterviewTuningProvider ownerId="tuning-tester"><LiveProbe /><MockInterview blocked={blocked} onActivity={vi.fn()} onComplete={complete} /></InterviewTuningProvider>)
  return complete
}
beforeEach(() => { recorderStop.mockReset().mockResolvedValue([]); fetcher.mockReset(); fetcher.mockImplementation(async () => new Response('Use an atomic sliding window.')); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
async function testAnswer() {
  fireEvent.click(screen.getByText('Open live copilot for mock test'))
  fireEvent.click(screen.getByText('Generate test answer'))
  await screen.findByText('Use an atomic sliding window.')
}
describe('mock calibrates the live system', () => {
  it('cannot begin another test while the previous microphone flush is finishing', async () => {
    let finish!: () => void
    recorderStop.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    mount()
    fireEvent.click(screen.getByText('Open live copilot for mock test'))
    fireEvent.click(screen.getByText('End test & open feedback'))
    const open = screen.getByText('Open live copilot for mock test') as HTMLButtonElement
    expect(open.disabled).toBe(true)
    finish()
    await waitFor(() => expect(open.disabled).toBe(false))
  })
  it('uses the real answer transport and holds expected behavior out of generation', async () => {
    mount()
    fireEvent.change(screen.getByLabelText(/Expected behavior/), { target: { value: 'REFERENCE_ONLY' } })
    fireEvent.change(screen.getByLabelText('Draft live calibration instructions'), { target: { value: 'Answer concisely.' } })
    await testAnswer()
    expect(fetcher.mock.calls[0][0]).toBe('/api/copilot/answer')
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.calibration).toBe('Answer concisely.')
    expect(body.instructions).toBe('Existing mode preferences')
    expect(body.context).toBe('Existing grounding')
    expect(JSON.stringify(body)).not.toContain('REFERENCE_ONLY')
    expect(screen.getByTestId('live-profile').textContent).toBe('0:')
    expect(screen.queryByLabelText('Your answer')).toBeNull()
  })
  it('requires a passed exact-draft test before publication and supports rollback', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Draft live calibration instructions'), { target: { value: 'Answer concisely.' } })
    expect((screen.getByText('Apply to Live') as HTMLButtonElement).disabled).toBe(true)
    await testAnswer()
    expect((screen.getByText('Apply to Live') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Review result'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByText('Apply to Live'))
    expect(screen.getByTestId('live-profile').textContent).toBe('1:Answer concisely.')
    fireEvent.change(screen.getByLabelText('Draft live calibration instructions'), { target: { value: 'An untested change.' } })
    expect((screen.getByText('Apply to Live') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Roll back live profile'))
    expect(screen.getByTestId('live-profile').textContent).toBe('2:')
  })
  it('saves AI outputs as system feedback, never as candidate answers', async () => {
    const complete = mount()
    await testAnswer()
    fireEvent.click(screen.getByText('End test & open feedback'))
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    const session = complete.mock.calls[0][0]
    expect(session.kind).toBe('tuning')
    expect(session.turns).toEqual([])
    expect(session.transcript).toContain('AI COPILOT OUTPUT (not a candidate answer)')
    expect(session.transcript).toContain('Client-measured first token:')
  })
  it('does not allow a test request error to become an accepted run', async () => {
    fetcher.mockImplementation(async () => new Response('failure', { status: 503 }))
    mount()
    fireEvent.click(screen.getByText('Open live copilot for mock test'))
    fireEvent.click(screen.getByText('Generate test answer'))
    await screen.findByLabelText('Review result')
    expect((screen.getByRole('option', { name: /Pass —/ }) as HTMLOptionElement).disabled).toBe(true)
    expect((screen.getByText('Apply to Live') as HTMLButtonElement).disabled).toBe(true)
  })
  it('blocks mock and profile changes during live capture', () => {
    mount(true)
    expect((screen.getByText('Open live copilot for mock test') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Draft live calibration instructions') as HTMLTextAreaElement).disabled).toBe(true)
  })
  it('does not persist a profile to another account', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Draft live calibration instructions'), { target: { value: 'Account one preference.' } })
    await testAnswer()
    fireEvent.change(screen.getByLabelText('Review result'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByText('Apply to Live'))
    cleanup()
    render(<InterviewTuningProvider ownerId="other-account"><LiveProbe /></InterviewTuningProvider>)
    expect(screen.getByTestId('live-profile').textContent).toBe('0:')
  })
})
