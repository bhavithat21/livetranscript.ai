import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RepositoryCoach } from './RepositoryCoach'
import type { CoachController, CoachTransport } from '@/lib/coach/controller'
vi.mock('./LearningPanel', () => ({ LearningPanel: () => null }))
afterEach(() => { cleanup(); vi.useRealTimers() })

it('does not bill the old question while the next question and its constraints settle', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  let transcript = ''
  const packets: import('@/lib/coach/types').ContextPacket[] = []
  const transport: CoachTransport = async (_lane, packet) => { packets.push(packet); return new Promise(() => {}) }
  await act(async () => {
    render(<RepositoryCoach transport={transport} getQuestionTranscript={() => ({ text: transcript, endOfTurn: true })} onReady={({ controller }) => { controller.start('practice', 'Review'); controller.question('How does the original code work?') }} />)
  })
  transcript = 'Do not change the API. How should we handle retries?'
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(packets).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(packets).toHaveLength(2)
  expect(packets[1].question.text).toBe('How should we handle retries?')
  expect(packets[1].task.constraints.join(' ')).toContain('public APIs')
})

it('corrects a question, refreshes with newly observed code, and disables actions while paused', async () => {
  let controller!: CoachController
  const questions: string[] = []
  const files: number[] = []
  const transport: CoachTransport = async (lane, packet, { delta }) => {
    if (lane === 'talk') { questions.push(packet.question.text); files.push(packet.files.length); delta(`Answer to: ${packet.question.text}`, 'test-model') }
    return { model: 'test-model', guidance: null }
  }
  render(<RepositoryCoach transport={transport} onReady={resources => { controller = resources.controller; controller.start('practice', 'Explain the service'); controller.question('Is it synchronous?') }} />)
  const currentAnswer = within(await screen.findByRole('region', { name: 'Say now' }))
  await currentAnswer.findByText('Answer to: Is it synchronous?')
  fireEvent.click(screen.getByRole('button', { name: 'Correct question' }))
  fireEvent.change(screen.getByLabelText('What did the interviewer ask?'), { target: { value: 'How should we handle concurrency?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Answer this question' }))
  await currentAnswer.findByText('Answer to: How should we handle concurrency?')
  expect(questions).toEqual(['Is it synchronous?', 'How should we handle concurrency?'])
  expect(currentAnswer.queryByText('Answer to: Is it synchronous?')).toBeNull()
  expect(screen.getByText('Round progress · 2 questions')).toBeTruthy()
  act(() => controller.observe({ files: [{ path: 'Service.java', language: 'java', startLine: 1, lines: ['class Service {}'], confidence: 1, endOfFile: true }], visiblePaths: ['Service.java'], terminal: '', requirements: [] }))
  expect(screen.getByText(/New screen evidence is available/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh answer' }))
  await waitFor(() => expect(files).toEqual([0, 0, 1]))
  fireEvent.click(screen.getByRole('button', { name: 'Pause coach' }))
  expect((screen.getByRole('button', { name: 'Refresh answer' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Correct question' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Resume coach' }))
  expect((screen.getByRole('button', { name: 'Correct question' }) as HTMLButtonElement).disabled).toBe(false)
})

it('keeps a failed partial answer visibly incomplete and offers explicit recovery', async () => {
  const transport: CoachTransport = async (_lane, _packet, { delta }) => { delta('A partial explanation', 'test-model'); throw new Error('Disconnected') }
  render(<RepositoryCoach transport={transport} onReady={({ controller }) => { controller.start('practice', 'Explain'); controller.question('Why?') }} />)
  await screen.findByText('Incomplete')
  expect(screen.getByRole('alert').textContent).toContain('model request failed')
  expect(screen.getByRole('button', { name: 'Retry talk' })).toBeTruthy()
  expect(screen.queryByText('Ready')).toBeNull()
})

it('keeps a labelled starting cue through a failed request, then replaces it with the streamed answer', async () => {
  let attempts = 0
  let fail!: (error: Error) => void
  const transport: CoachTransport = async (_lane, _packet, { delta }) => {
    if (++attempts === 1) return new Promise((_resolve, reject) => { fail = reject })
    delta('After acknowledgment, record the failure on the job and expose it through the status request.', 'test-model')
    return { model: 'test-model', guidance: null }
  }
  render(<RepositoryCoach transport={transport} onReady={({ controller }) => { controller.start('practice', 'Discuss background jobs'); controller.question('What goes in the catch block?') }} />)
  const answer = within(await screen.findByRole('region', { name: 'Say now' }))
  expect(answer.getByText(/I’d trace where the failure happens/)).toBeTruthy()
  expect(answer.getByText(/Starting cue · a thinking approach, not a verified answer/)).toBeTruthy()
  await act(async () => fail(new Error('Disconnected')))
  expect(answer.getByText(/I’d trace where the failure happens/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry talk' }))
  await answer.findByText(/After acknowledgment, record the failure/)
  expect(answer.queryByText(/Starting cue/)).toBeNull()
})

it('clears the old failure when the current question successfully retries', async () => {
  let attempts = 0
  const transport: CoachTransport = async (_lane, _packet, { delta }) => {
    if (++attempts === 1) throw new Error('Temporary failure')
    delta('A complete answer after retry.', 'test-model')
    return { model: 'test-model', guidance: null }
  }
  render(<RepositoryCoach transport={transport} onReady={({ controller }) => { controller.start('practice', 'Explain'); controller.question('Why?') }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry talk' }))
  await screen.findByText('Ready')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry talk' })).toBeNull()
})

it('keeps preview optional without stopping the shared source when collapsed', async () => {
  const stopped = vi.fn()
  let observer!: import('@/lib/coach/screen').ScreenObserver
  const transport: CoachTransport = async () => ({ model: 'test', guidance: null })
  render(<RepositoryCoach transport={transport} onReady={({ controller, screen: capture }) => { controller.start('practice', 'Inspect'); observer = capture }} />)
  await screen.findByRole('button', { name: 'Share screen' })
  await act(async () => observer.attach({ signal: async () => null, image: async () => null, stop: stopped }, 'browser'))
  const toggle = screen.getByText(/Shared screen preview/)
  const details = toggle.closest('details')!
  expect(details.open).toBe(false)
  expect(details.querySelector('video')).not.toBeNull()
  fireEvent.click(toggle)
  expect(details.open).toBe(true)
  fireEvent.click(toggle)
  expect(details.open).toBe(false)
  expect(observer.getSnapshot().sharing).toBe(true)
  expect(stopped).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
  await waitFor(() => expect(stopped).toHaveBeenCalledOnce())
})
