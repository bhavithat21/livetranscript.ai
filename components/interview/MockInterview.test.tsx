// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/interview/client', () => ({ requestInterview: mocks.request, downloadInterview: vi.fn() }))
vi.mock('@/lib/interview/useInterviewRecorder', () => ({
  useInterviewRecorder: () => ({ start: vi.fn(), stop: vi.fn().mockResolvedValue([]), phase: 'idle', segments: [], error: null }), captureText: () => '',
}))
import { MockInterview } from './MockInterview'
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)
describe('mock interview flow', () => {
  it('submits distinct candidate answers and finishes after the chosen number of questions', async () => {
    mocks.request.mockResolvedValueOnce('Question one?').mockResolvedValueOnce('Question two?').mockResolvedValueOnce('Question three?')
    const complete = vi.fn()
    render(<MockInterview blocked={false} onActivity={vi.fn()} onComplete={complete} />)
    fireEvent.change(screen.getByLabelText('Questions'), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Start mock interview'))
    for (const [index, question] of ['Question one?', 'Question two?', 'Question three?'].entries()) {
      await screen.findByText(question)
      fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: `Answer ${index + 1}` } })
      fireEvent.click(screen.getByText(index === 2 ? 'Submit & open feedback' : 'Submit answer'))
    }
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    expect(complete.mock.calls[0][0].turns).toEqual([
      { question: 'Question one?', answer: 'Answer 1' },
      { question: 'Question two?', answer: 'Answer 2' },
      { question: 'Question three?', answer: 'Answer 3' },
    ])
    expect(mocks.request).toHaveBeenCalledTimes(3)
  })
  it('keeps submitted answers when the next question fails and retries without duplication', async () => {
    mocks.request.mockResolvedValueOnce('Initial question?').mockRejectedValueOnce(new Error('Temporary outage')).mockResolvedValueOnce('Follow-up question?')
    const complete = vi.fn()
    render(<MockInterview blocked={false} onActivity={vi.fn()} onComplete={complete} />)
    fireEvent.click(screen.getByText('Start mock interview'))
    await screen.findByText('Initial question?')
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'My first answer' } })
    fireEvent.click(screen.getByText('Submit answer'))
    await screen.findByText('Temporary outage')
    fireEvent.click(screen.getByText('Retry next question'))
    await screen.findByText('Follow-up question?')
    expect(mocks.request.mock.calls[2][0].turns).toEqual([{ question: 'Initial question?', answer: 'My first answer' }])
    fireEvent.click(screen.getByText('Finish early & review'))
    expect(complete.mock.calls[0][0].turns).toHaveLength(1)
  })
})
