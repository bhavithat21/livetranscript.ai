import { useState, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInterviewHistory, type HistoryStore } from '@/lib/interview/history'
import type { InterviewSession } from '@/lib/interview/session'

const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/interview/client', () => ({ requestInterview: mocks.request, downloadInterview: mocks.download }))
vi.mock('@/components/copilot/Markdown', () => ({ Markdown: ({ children }: { children: string }) => <p>{children}</p> }))
import { InterviewFeedback } from './InterviewFeedback'

function entry(id: string, patch: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id, kind: 'live', title: `Session ${id}`, createdAt: Date.UTC(2026, 8, 22, 10), durationSeconds: 125,
    transcript: `Interviewer: Explain ${id}.\nCandidate: Here is the reasoning for ${id}.`,
    turns: [], captureNote: `Capture coverage for ${id}.`, ...patch,
  }
}

function Harness({ store }: { store: HistoryStore }) {
  const history = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const [selectedId, select] = useState<string | null>(null)
  return <InterviewFeedback sessions={history.sessions} selectedId={selectedId} onSelect={select} store={store} />
}

function setup(sessions: InterviewSession[] = [], owner = 'feedback-test') {
  const store = createInterviewHistory(owner, () => window.localStorage)
  for (const session of [...sessions].reverse()) store.add(session)
  return { ...render(<Harness store={store} />), store }
}

function stat(label: string) {
  return within(screen.getByRole('region', { name: 'Session overview' })).getByText(label).nextElementSibling?.textContent
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => { window.localStorage.clear(); mocks.request.mockReset(); mocks.download.mockReset() })
afterEach(() => { cleanup(); window.localStorage.clear() })

describe('feedback overview and session browsing', () => {
  it('shows factual counts and saved duration, including legacy time but no invented scores', () => {
    setup([
      entry('live', { feedback: 'A saved candidate review.' }),
      entry('tuning', { kind: 'tuning', durationSeconds: 65, feedback: 'A saved system review.' }),
      entry('legacy', { kind: 'mock', durationSeconds: 30 }),
      entry('import', { durationSeconds: 0, feedback: '  ' }),
    ])
    expect(stat('Live sessions')).toBe('2')
    expect(stat('System tests')).toBe('1')
    expect(stat('Session time')).toBe('3m 40s')
    expect(stat('Reviewed')).toBe('2')
    expect(screen.getByText('4 saved')).toBeTruthy()
    expect(screen.getByText('No duration captured')).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'View Session live' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'View Session tuning' }))
    expect(screen.getByRole('heading', { name: 'Session tuning' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View Session tuning' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('A saved system review.')).toBeTruthy()
    expect(screen.getByText(/This review evaluates the AI system/)).toBeTruthy()
    expect(screen.queryByText('A saved candidate review.')).toBeNull()
  })

  it('has an honest empty state and imports a transcript without inventing duration or generating a review', () => {
    const { store } = setup()
    expect(screen.getByRole('heading', { name: 'Your session history starts here' })).toBeTruthy()
    expect(stat('Live sessions')).toBe('0')
    expect(stat('Session time')).toBe('0s')
    expect(stat('Reviewed')).toBe('0')
    fireEvent.click(screen.getByText('Review an existing transcript'))
    const field = screen.getByLabelText('Paste transcript (identify Interviewer and Candidate where known)') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: '  Interviewer: Why?\nCandidate: Because of the constraints.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to feedback history' }))
    expect(screen.getByRole('heading', { name: 'Imported interview transcript' })).toBeTruthy()
    expect(field.value).toBe('')
    expect(store.getSnapshot().sessions[0]).toMatchObject({ durationSeconds: 0, kind: 'live', transcript: 'Interviewer: Why?\nCandidate: Because of the constraints.' })
    expect(store.getSnapshot().sessions[0].captureNote).toContain('unverified')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(stat('Live sessions')).toBe('1')
    expect(stat('Reviewed')).toBe('0')
    expect(screen.getByText(/Choose Generate review/)).toBeTruthy()
    expect(screen.queryByText(/Choose Generate feedback/)).toBeNull()
  })

  it('exports the selected evidence and asks before deleting its saved history', () => {
    const first = entry('first', { feedback: 'First review.' })
    const second = entry('second', { feedback: 'Second review.', feedbackCoverage: 'Only selected evidence.' })
    const { store } = setup([first, second])
    fireEvent.click(screen.getByRole('button', { name: 'View Session second' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export report & transcript' }))
    expect(mocks.download).toHaveBeenCalledWith('Session second', expect.stringContaining(second.transcript))
    expect(mocks.download.mock.calls[0][1]).toContain('Second review.')
    expect(mocks.download.mock.calls[0][1]).toContain('Only selected evidence.')
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }))
    expect(store.getSnapshot().sessions).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Keep session' }))
    expect(screen.queryByRole('group', { name: 'Confirm session deletion' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(store.getSnapshot().sessions.map((item) => item.id)).toEqual(['first'])
    expect(screen.getByRole('heading', { name: 'Session first' })).toBeTruthy()
    expect(stat('Reviewed')).toBe('1')
  })
})

describe('feedback review lifecycle', () => {
  it('keeps a running review attached to its original session while another session is selected and deleted', async () => {
    const pending = deferred<string>()
    mocks.request.mockReturnValue(pending.promise)
    const { store } = setup([entry('system', { kind: 'tuning' }), entry('other')])
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'feedback', subject: 'copilot', transcript: entry('system').transcript }), expect.any(AbortSignal))
    expect((screen.getByRole('button', { name: 'Delete session' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'View Session other' }))
    expect((screen.getByRole('button', { name: 'Generate review' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete session' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('Session system')
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await act(async () => { pending.resolve('Only the system was reviewed.'); await pending.promise })
    expect(store.getSnapshot().sessions).toHaveLength(1)
    expect(store.getSnapshot().sessions[0]).toMatchObject({ id: 'system', feedback: 'Only the system was reviewed.' })
    expect(stat('Reviewed')).toBe('1')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('aborts a canceled review and ignores its late result after a new review starts', async () => {
    const old = deferred<string>()
    const fresh = deferred<string>()
    mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const { store } = setup([entry('candidate')])
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    const signal = mocks.request.mock.calls[0][1] as AbortSignal
    expect(mocks.request.mock.calls[0][0].subject).toBe('candidate')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }))
    expect(signal.aborted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    await act(async () => { old.resolve('Outdated review.'); await old.promise })
    expect(store.getSnapshot().sessions[0].feedback).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Reviewing session…' })).toBeTruthy()
    await act(async () => { fresh.resolve('Current review.'); await fresh.promise })
    expect(store.getSnapshot().sessions[0].feedback).toBe('Current review.')
    expect(screen.getByRole('button', { name: 'Regenerate review' })).toBeTruthy()
  })

  it('preserves existing evidence and allows retry after an unsuccessful review', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Provider temporarily unavailable.')).mockResolvedValueOnce('A recovered review.')
    const { store } = setup([entry('retry')])
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Provider temporarily unavailable.')
    expect(store.getSnapshot().sessions[0].transcript).toBe(entry('retry').transcript)
    expect(stat('Reviewed')).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    await waitFor(() => expect(store.getSnapshot().sessions[0].feedback).toBe('A recovered review.'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not resurrect an externally deleted session when a request finishes', async () => {
    const pending = deferred<string>()
    mocks.request.mockReturnValue(pending.promise)
    const { store } = setup([entry('deleted')])
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    act(() => store.remove('deleted'))
    await act(async () => { pending.resolve('Late review.'); await pending.promise })
    expect(store.getSnapshot().sessions).toEqual([])
    expect(screen.getByRole('heading', { name: 'Your session history starts here' })).toBeTruthy()
    expect(stat('Reviewed')).toBe('0')
  })

  it('keeps cancellation available if another tab deletes the session being reviewed', async () => {
    const pending = deferred<string>()
    mocks.request.mockReturnValue(pending.promise)
    const { store } = setup([entry('deleted')])
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    const signal = mocks.request.mock.calls[0][1] as AbortSignal
    act(() => store.remove('deleted'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('status')).toBeNull()
    await act(async () => { pending.resolve('Late review.'); await pending.promise })
    expect(store.getSnapshot().sessions).toEqual([])
  })

  it('aborts on unmount and keeps owner histories separate', async () => {
    const pending = deferred<string>()
    mocks.request.mockReturnValue(pending.promise)
    const one = setup([entry('private')], 'owner-one')
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    const signal = mocks.request.mock.calls[0][1] as AbortSignal
    one.unmount()
    const two = setup([], 'owner-two')
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve('Private review.'); await pending.promise })
    expect(two.store.getSnapshot().sessions).toEqual([])
    expect(one.store.getSnapshot().sessions[0].feedback).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'View Session private' })).toBeNull()
  })
})
