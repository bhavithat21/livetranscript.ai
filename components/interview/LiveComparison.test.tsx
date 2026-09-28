import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CoachController } from '@/lib/coach/controller'
import { ScreenObserver } from '@/lib/coach/screen'
import type { RepositoryCoachProps } from '@/components/coach/RepositoryCoach'
import type { CapturedSegment } from '@/lib/interview/useInterviewRecorder'

const stubs = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), resources: null as Parameters<NonNullable<RepositoryCoachProps['onReady']>>[0] | null }))
vi.mock('@/lib/interview/useInterviewRecorder', () => ({
  useInterviewRecorder: () => ({ start: stubs.start, stop: stubs.stop, getSegments: () => [], segments: [], phase: 'idle', error: null, level: 0 }),
  liveTranscript: (rows: CapturedSegment[]) => rows.map(row => row.text).join('\n'),
}))
vi.mock('@/lib/interview/TuningContext', () => ({ useInterviewTuning: () => ({ state: { active: { revision: 1, instructions: '' } } }) }))
vi.mock('@/lib/transcription/useKeytermPrefs', () => ({ useKeytermPrefs: () => ({ keyterms: [] }) }))
vi.mock('./LiveAnswerCanvas', () => ({ LiveAnswerCanvas: () => null }))
vi.mock('@/components/coach/RepositoryCoach', async () => {
  const { useEffect } = await import('react')
  return { RepositoryCoach: ({ onReady }: RepositoryCoachProps) => {
    useEffect(() => { if (stubs.resources) onReady?.(stubs.resources) }, [onReady])
    return <p>Comparison fixture coach</p>
  } }
})
import { LiveInterview } from './LiveInterview'
afterEach(() => { cleanup(); stubs.resources?.controller.dispose(); stubs.resources?.screen.dispose(); vi.clearAllMocks() })

it.each([false, true])('ends screen/model work immediately and saves comparison only with opt-in (%s)', async save => {
  const controller = new CoachController(async () => ({ model: 'fixture', guidance: null }))
  const capture = new ScreenObserver(() => {})
  stubs.resources = { controller, screen: capture }
  controller.start('practice', 'Inspect the source')
  controller.question('How should this work?')
  const stopScreen = vi.spyOn(capture, 'stop'), endCoach = vi.spyOn(controller, 'end')
  stubs.start.mockResolvedValue(undefined)
  const completions: Array<(rows: CapturedSegment[]) => void> = []
  stubs.stop.mockImplementation(() => new Promise<CapturedSegment[]>(resolve => completions.push(resolve)))
  const onComplete = vi.fn()
  render(<LiveInterview visible blocked={false} videoTest onActivity={() => {}} onComplete={onComplete} />)
  const choice = screen.getByRole('checkbox', { name: /Save AI answers/ }) as HTMLInputElement
  expect(choice.checked).toBe(false)
  if (save) fireEvent.click(choice)
  fireEvent.click(screen.getByRole('checkbox', { name: /I have permission to record/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
  await screen.findByText('Comparison fixture coach')
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  expect(stopScreen).toHaveBeenCalledOnce()
  expect(endCoach).toHaveBeenCalledOnce()
  expect(onComplete).not.toHaveBeenCalled() // audio is still draining
  await act(async () => completions.forEach(resolve => resolve([{ id: 1, text: 'Explain the implementation.', capturedAt: Date.now(), isFinal: true, speaker: 0 }])))
  expect(onComplete).toHaveBeenCalledOnce()
  const session = onComplete.mock.calls[0][0]
  expect(session.transcript).toBe('Explain the implementation.')
  if (save) expect(session.coachReview).toContain('copilot-comparison-record')
  else expect(session).not.toHaveProperty('coachReview')
})
