import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveAnswerCanvas } from './LiveAnswerCanvas'

const mocks = vi.hoisted(() => ({
  route: vi.fn(), answer: vi.fn(), stop: vi.fn(), proactive: vi.fn(),
  generalRetrieve: vi.fn(), behavioralStories: vi.fn(), behavioralRetrieve: vi.fn(),
  modeContext: vi.fn(),
}))

vi.mock('@/lib/copilot/useOrchestrationRouter', () => ({ useOrchestrationRouter: () => ({ route: mocks.route }) }))
vi.mock('@/lib/copilot/useAnswerFeed', () => ({ useAnswerFeed: () => ({
  current: null, count: 0, cursor: 0, answer: mocks.answer, stop: mocks.stop,
  retry: vi.fn(), prev: vi.fn(), next: vi.fn(),
}) }))
vi.mock('@/lib/copilot/useProactive', () => ({ useProactive: (...args: unknown[]) => mocks.proactive(...args) }))
vi.mock('@/lib/copilot/useCandidateProfile', () => ({ useCandidateProfile: () => ({ contextBlock: () => 'Candidate background' }) }))
vi.mock('@/lib/copilot/useMeContext', () => ({ useMeContext: () => ({ getMeContext: () => 'My prior explanation' }) }))
vi.mock('@/lib/copilot/useModeContext', () => ({ useModeContext: (mode: string) => mocks.modeContext(mode) }))
vi.mock('@/lib/copilot/useResponsePreferences', () => ({ useResponsePreferences: () => ({
  preferences: { format: 'concise', tone: 'collaborative', followups: false },
  setFormat: vi.fn(), setTone: vi.fn(), setFollowups: vi.fn(),
}) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function capturedQuestion(question: string) {
  const callback = mocks.proactive.mock.lastCall?.[2] as (question: string) => Promise<void>
  if (!callback) throw new Error('Question detector has not mounted')
  return callback(question)
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  mocks.route.mockReset().mockResolvedValue({ classification: { mode: 'general', isQuestion: true }, webContext: null })
  mocks.answer.mockReset().mockResolvedValue(undefined)
  mocks.stop.mockReset()
  mocks.proactive.mockReset().mockReturnValue({ lastAsked: null })
  mocks.generalRetrieve.mockReset().mockResolvedValue('General reference material')
  mocks.behavioralRetrieve.mockReset().mockResolvedValue('Behavioral reference material')
  mocks.behavioralStories.mockReset().mockResolvedValue([{ title: 'Queue migration', fullText: 'I tested the retry boundary before rollout.' }])
  mocks.modeContext.mockReset().mockImplementation((mode: string) => mode === 'behavioral'
    ? { count: 1, storyCount: 1, instructions: 'Use my actual migration story.', retrieveStories: mocks.behavioralStories, retrieve: mocks.behavioralRetrieve }
    : { count: mode === 'general' ? 1 : 0, storyCount: 0, instructions: `${mode} instructions`, retrieve: mocks.generalRetrieve, retrieveStories: vi.fn() })
})

afterEach(cleanup)

describe('live answer context and cancellation', () => {
  it('uses behavioral stories and instructions on the first auto-routed behavioral question', async () => {
    mocks.route.mockResolvedValue({ classification: { mode: 'behavioral', isQuestion: true }, webContext: null })
    render(<LiveAnswerCanvas getTranscript={() => 'The full discussion'} />)

    await act(async () => { await capturedQuestion('Tell me about a technical disagreement.') })

    expect(mocks.modeContext.mock.calls.map(([mode]) => mode)).toContain('behavioral')
    expect(mocks.behavioralStories).toHaveBeenCalledExactlyOnceWith('Tell me about a technical disagreement.', 2)
    expect(mocks.generalRetrieve).not.toHaveBeenCalled()
    expect(mocks.behavioralRetrieve).not.toHaveBeenCalled()
    expect(mocks.answer).toHaveBeenCalledExactlyOnceWith(
      'Tell me about a technical disagreement.',
      'behavioral',
      'Candidate background\n\nWhat I said: My prior explanation\n\nSTORY — Queue migration\nI tested the retry boundary before rollout.',
      null,
      'Use my actual migration story.',
      'The full discussion',
    )
  })

  it('detects questions from its dedicated getter and grounds answers in the latest full discussion', async () => {
    let fullDiscussion = 'Earlier discussion'
    const getFull = () => fullDiscussion
    const getQuestions = () => 'Only incoming interviewer speech'
    render(<LiveAnswerCanvas getTranscript={getFull} getQuestionTranscript={getQuestions} />)

    expect(mocks.proactive.mock.lastCall?.[0]).toBe(true)
    expect(mocks.proactive.mock.lastCall?.[1]).toBe(getQuestions)
    expect(mocks.proactive.mock.lastCall?.[1]()).toBe('Only incoming interviewer speech')
    fullDiscussion = 'Earlier discussion plus candidate clarification'
    await act(async () => { await capturedQuestion('Why use a queue?') })

    expect(mocks.answer.mock.lastCall?.[5]).toBe('Earlier discussion plus candidate clarification')
    expect(mocks.answer.mock.lastCall?.[5]).not.toBe(getQuestions())
  })

  for (const phase of ['routing', 'retrieval'] as const) {
    for (const end of ['pause', 'unmount'] as const) {
      it(`does not start an answer after ${end} while ${phase} is pending`, async () => {
        const route = deferred<{ classification: { mode: 'general'; isQuestion: true }; webContext: null }>()
        const retrieval = deferred<string>()
        if (phase === 'routing') mocks.route.mockReturnValue(route.promise)
        else mocks.generalRetrieve.mockReturnValue(retrieval.promise)
        const view = render(<LiveAnswerCanvas getTranscript={() => 'Full context'} />)
        let pending!: Promise<void>
        act(() => { pending = capturedQuestion('What bounds the retries?') })
        await flush()
        if (phase === 'retrieval') expect(mocks.generalRetrieve).toHaveBeenCalledOnce()

        if (end === 'pause') {
          fireEvent.click(screen.getByRole('button', { name: 'Pause answers' }))
          expect(mocks.stop).toHaveBeenCalledTimes(2)
          expect(mocks.proactive.mock.lastCall?.[0]).toBe(false)
        } else view.unmount()
        await act(async () => {
          if (phase === 'routing') route.resolve({ classification: { mode: 'general', isQuestion: true }, webContext: null })
          else retrieval.resolve('Late evidence')
          await pending
        })

        expect(mocks.answer).not.toHaveBeenCalled()
        if (phase === 'routing') expect(mocks.generalRetrieve).not.toHaveBeenCalled()
      })
    }
  }
})
