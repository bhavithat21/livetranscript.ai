import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotPanel } from './CopilotPanel'

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  contextRetrieve: vi.fn(),
  showQuestion: vi.fn(),
  screenRepo: {} as Record<string, unknown>,
}))

vi.mock('@/lib/copilot/useCopilot', () => ({ useCopilot: () => ({ turns: [], streaming: false, error: null, ask: vi.fn(), clear: vi.fn() }) }))
vi.mock('@/lib/vision/useScreenStream', () => ({ useScreenStream: () => ({ sharing: false, error: null, start: vi.fn(), stop: vi.fn(), grabFrame: vi.fn(), grabCodeFrame: vi.fn() }) }))
vi.mock('@/lib/copilot/useModeContext', () => ({ useModeContext: () => ({
  docs: [], count: 1, storyCount: 0, instructions: '', retrieve: mocks.contextRetrieve,
  retrieveStories: vi.fn(), addDocument: vi.fn(), setInstructions: vi.fn(), clear: vi.fn(), resetSpent: vi.fn(),
}) }))
vi.mock('@/lib/copilot/useCandidateProfile', () => ({ useCandidateProfile: () => ({ hasProfile: false, resume: '', jd: '', savedNote: '', setResume: vi.fn(), setJd: vi.fn(), clear: vi.fn(), contextBlock: () => null }) }))
vi.mock('@/lib/copilot/useOrchestrationRouter', () => ({ useOrchestrationRouter: () => ({ route: vi.fn() }) }))
vi.mock('@/lib/copilot/useAnswerFeed', () => ({ useAnswerFeed: () => ({ count: 0, answer: vi.fn(), questions: () => [] }) }))
vi.mock('@/lib/copilot/useMeContext', () => ({ useMeContext: () => ({ listening: false, startListening: vi.fn(), stopListening: vi.fn(), getMeContext: () => '' }) }))
vi.mock('@/lib/copilot/useProactive', () => ({ useProactive: vi.fn(), latestQuestion: () => null }))
vi.mock('@/lib/vision/useAutoCapture', () => ({ useAutoCapture: vi.fn() }))
vi.mock('@/lib/copilot/useOrchestrator', () => ({ useOrchestrator: () => ({ stage: 'idle', testResult: null, problem: null, error: null, process: vi.fn(), reset: vi.fn() }) }))
vi.mock('@/lib/desktop/useLockMode', () => ({ useLockMode: () => ({ available: false, locked: false, enable: vi.fn() }) }))
vi.mock('@/lib/desktop/useAppIdentity', () => ({ useAppIdentity: () => ({ available: false, current: '', presets: [], setIdentity: vi.fn() }) }))
vi.mock('@/lib/repo/useScreenRepository', () => ({ useScreenRepository: () => mocks.screenRepo }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function repoState() {
  return {
    snapshot: { captures: 0, revision: 0, files: [], visiblePaths: [], terminal: '', requirements: [] },
    watching: false,
    setWatching: vi.fn(),
    capturing: false,
    captureError: null,
    captureModel: '',
    capture: vi.fn(),
    captureImage: vi.fn(),
    analysis: null,
    displayAnalysis: null,
    history: [],
    displayId: null,
    setDisplayId: vi.fn(),
    showQuestion: mocks.showQuestion,
    analyze: mocks.analyze,
    stopAnalysis: vi.fn(),
    reset: vi.fn(),
    contextFor: (question: string) => `screen evidence for ${question}`,
  }
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

function openRepo(transcript: () => string) {
  render(<CopilotPanel getTranscript={transcript} onClose={vi.fn()} width={420} onResizeStart={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Repo interview' }))
}

function ledgerButton(text: string): HTMLButtonElement {
  const match = screen.getAllByText(text).map((node) => node.closest('button')).find(Boolean)
  if (!match) throw new Error(`No ledger button found for ${text}`)
  return match as HTMLButtonElement
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mocks.analyze.mockReset()
  mocks.contextRetrieve.mockReset().mockResolvedValue('uploaded notes')
  mocks.showQuestion.mockReset()
  mocks.screenRepo = repoState()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('repository interview product journey', () => {
  it('keeps capturing while analysis runs and drains settled questions in order', async () => {
    let transcript = 'Where is authentication handled?'
    const first = deferred<boolean>()
    mocks.analyze.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(true)
    openRepo(() => transcript)
    await flush()
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-answer questions' }))

    await act(async () => { vi.advanceTimersByTime(1_301); await Promise.resolve() })
    expect(mocks.analyze).toHaveBeenCalledTimes(1)
    expect(mocks.analyze.mock.calls[0][0]).toBe('Where is authentication handled?')

    transcript += ' What happens when token validation fails?'
    await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve() })
    expect(screen.getByText('2 questions')).toBeTruthy()
    expect(ledgerButton('What happens when token validation fails?')).toBeTruthy()
    expect(mocks.analyze).toHaveBeenCalledTimes(1)

    await act(async () => { first.resolve(true); await first.promise })
    await act(async () => { vi.advanceTimersByTime(1_301); await Promise.resolve() })
    expect(mocks.analyze).toHaveBeenCalledTimes(2)
    expect(mocks.analyze.mock.calls.map((call) => call[0])).toEqual([
      'Where is authentication handled?',
      'What happens when token validation fails?',
    ])
  })

  it('surfaces preparation failure and lets the failed ledger question retry manually', async () => {
    const transcript = 'Which service owns order cancellation?'
    mocks.contextRetrieve.mockRejectedValueOnce(new Error('Embedding index unavailable')).mockResolvedValueOnce('recovered notes')
    mocks.analyze.mockResolvedValue(true)
    openRepo(() => transcript)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('Embedding index unavailable')
    expect(screen.getByText('failed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flush()
    expect(mocks.analyze).toHaveBeenCalledTimes(1)
    expect(mocks.analyze.mock.calls[0][0]).toBe(transcript)
    expect(screen.queryByText('Embedding index unavailable')).toBeNull()
  })

  it('keeps explicit question selection aligned with answer history', async () => {
    let transcript = 'Where is authentication handled? What tests cover order cancellation?'
    mocks.screenRepo.history = [
      { id: 'auth-answer', question: 'Where is authentication handled?', task: 'plan', answer: 'Auth answer', revision: 0, agents: [], running: false, error: null },
      { id: 'orders-answer', question: 'What tests cover order cancellation?', task: 'plan', answer: 'Orders answer', revision: 0, agents: [], running: false, error: null },
    ]
    mocks.showQuestion.mockImplementation((question: string, questionId?: string) => {
      const entry = (mocks.screenRepo.history as Array<{ question: string; questionId?: string }>).find((item) =>
        questionId ? item.questionId === questionId : item.question === question,
      )
      mocks.screenRepo.displayAnalysis = entry ?? null
    })
    openRepo(() => transcript)
    await flush()

    fireEvent.click(ledgerButton('Where is authentication handled?'))
    expect(mocks.showQuestion).toHaveBeenLastCalledWith('Where is authentication handled?', expect.any(String))

    transcript += ' How are retries bounded?'
    await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve() })
    expect(ledgerButton('Where is authentication handled?').getAttribute('data-active')).toBe('true')
    expect(mocks.showQuestion).toHaveBeenCalledTimes(1)
  })

  it('retries a failed specialist analysis through the full repository context pipeline', async () => {
    const transcript = 'Why does cancellation publish twice?'
    mocks.screenRepo.displayAnalysis = {
      id: 'failed-analysis', question: transcript, task: 'debug', answer: 'Partial finding',
      revision: 0, agents: [], running: false, error: 'Analysis stream ended early',
    }
    mocks.analyze.mockResolvedValue(true)
    openRepo(() => transcript)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }))
    await flush()
    expect(mocks.contextRetrieve).toHaveBeenCalledWith(transcript)
    expect(mocks.analyze).toHaveBeenCalledTimes(1)
    expect(mocks.analyze.mock.calls[0][0]).toBe(transcript)
    expect(mocks.analyze.mock.calls[0][1]).toContain('uploaded notes')
    expect(mocks.analyze.mock.calls[0][1]).toContain(`screen evidence for ${transcript}`)
    expect(mocks.analyze.mock.calls[0][3]).toBe('debug')
  })

  it('retries the exact ledger occurrence when identical wording appears twice', async () => {
    const repeated = 'How does cancellation work?'
    localStorage.setItem('lt.repoInterview.questions.v1', JSON.stringify([
      { id: 'first-occurrence', text: repeated, capturedAt: 1, status: 'answered' },
      { id: 'second-occurrence', text: repeated, capturedAt: 2, status: 'failed' },
    ]))
    mocks.screenRepo.displayAnalysis = {
      id: 'second-analysis', question: repeated, questionId: 'second-occurrence', task: 'review',
      answer: 'Partial answer', revision: 0, agents: [], running: false, error: 'Reviewer unavailable',
    }
    mocks.analyze.mockResolvedValue(true)
    openRepo(() => repeated)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }))
    await flush()
    expect(mocks.analyze).toHaveBeenCalledTimes(1)
    expect(mocks.analyze.mock.calls[0][0]).toBe(repeated)
    expect(mocks.analyze.mock.calls[0][3]).toBe('review')
    expect(mocks.analyze.mock.calls[0][4]).toBe('second-occurrence')
  })

  it('runs a specialist task for the selected repeated ledger occurrence', async () => {
    const repeated = 'Where is the retry policy?'
    localStorage.setItem('lt.repoInterview.questions.v1', JSON.stringify([
      { id: 'first-task-occurrence', text: repeated, capturedAt: 1, status: 'answered' },
      { id: 'second-task-occurrence', text: repeated, capturedAt: 2, status: 'captured' },
    ]))
    mocks.analyze.mockResolvedValue(true)
    openRepo(() => repeated)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'debug' }))
    await flush()
    expect(mocks.analyze).toHaveBeenCalledTimes(1)
    expect(mocks.analyze.mock.calls[0][0]).toBe(repeated)
    expect(mocks.analyze.mock.calls[0][3]).toBe('debug')
    expect(mocks.analyze.mock.calls[0][4]).toBe('second-task-occurrence')
  })
})
