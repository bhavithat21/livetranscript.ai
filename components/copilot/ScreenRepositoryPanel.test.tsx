import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScreenRepository } from '@/lib/repo/useScreenRepository'
import { ScreenRepositoryControls, RepoAnalysisView } from './ScreenRepositoryPanel'

function Session() {
  const repo = useScreenRepository(true, false, () => null)
  const [question, setQuestion] = useState('Why does cancelOrder publish twice?')
  return <>
    <input aria-label="Current question" value={question} onChange={(event) => setQuestion(event.target.value)} />
    <ScreenRepositoryControls repo={repo} sharing={false} startSharing={async () => {}} question={question}
      onAnalyze={(task) => { repo.setDisplayId(null); void repo.analyze(question, repo.contextFor(question), '', task) }} />
    <RepoAnalysisView repo={repo} onRetry={(retryQuestion, task) => { repo.setDisplayId(null); void repo.analyze(retryQuestion, repo.contextFor(retryQuestion), '', task) }} />
  </>
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('screenshot repository user flow', () => {
  it('imports visible code, guides navigation to missing lines, and displays a specialist answer', async () => {
    const observation = {
      files: [{ path: 'src/orders.ts', language: 'typescript', startLine: 10, lines: ['export function cancelOrder() {', '  publish();', '}'], confidence: 0.94, endOfFile: false }],
      visiblePaths: ['src/orders.ts', 'tests/orders.test.ts'], terminal: 'FAIL duplicate event', requirements: ['Cancellation must be idempotent'],
    }
    const events = [
      { type: 'agent', role: 'debugger', model: 'debug-test-model', status: 'done', text: 'The visible function publishes without a guard.', elapsedMs: 200 },
      { type: 'delta', text: '## Say now\nThe captured lines call publish. I need the caller to verify state checks.\n## Navigate\nOpen src/orders.ts at line 1.' },
      { type: 'done' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ observation, model: 'vision-test-model' }))
      .mockResolvedValueOnce(new Response(events))
    vi.stubGlobal('fetch', fetcher)
    const { container } = render(<Session />)
    expect((screen.getByRole('button', { name: 'Capture code' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['png'], 'editor.png', { type: 'image/png' })] } })
    await screen.findByText('1 captures · 1 files')
    expect(screen.getAllByText(/around line 1/).length).toBeGreaterThan(0)
    expect(screen.getByText('3 observed lines · partial')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'debug' }))
    await screen.findByRole('heading', { name: 'Say now' })
    expect(screen.getByText('debug-test-model · 0.2s')).toBeTruthy()
    expect(screen.getByText(/need the caller/)).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const sent = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(sent.context).toContain('MISSING lines 1-9')
    expect(sent.context).toContain('FAIL duplicate event')
    expect(sent.task).toBe('debug')
  })
})


it('keeps the current analysis stoppable while the user reads an earlier answer', async () => {
  const cancel = vi.fn()
  const ongoing = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Second partial answer"}\n')) },
    cancel,
  })
  const response = (text: string) => new Response(`${JSON.stringify({ type: 'delta', text })}\n{"type":"done"}\n`)
  const fetcher = vi.fn().mockResolvedValueOnce(response('First finished answer')).mockResolvedValueOnce(new Response(ongoing)).mockResolvedValueOnce(response('Retry completed successfully'))
  vi.stubGlobal('fetch', fetcher)
  render(<Session />)
  fireEvent.click(screen.getByRole('button', { name: 'debug' }))
  await screen.findByText('First finished answer')
  const firstAnswer = (screen.getByRole('combobox', { name: 'Answer history' }) as HTMLSelectElement).options[1].value
  fireEvent.change(screen.getByRole('textbox', { name: 'Current question' }), { target: { value: 'How should retries work?' } })
  fireEvent.click(screen.getByRole('button', { name: 'debug' }))
  await screen.findByText('Second partial answer')
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer history' }), { target: { value: firstAnswer } })
  expect(screen.getByText('First finished answer')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop current analysis' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  expect(screen.getByText('First finished answer')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Answer history' }), { target: { value: '' } })
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toContain('stopped or timed out')
  fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }))
  await screen.findByText('Retry completed successfully')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ question: 'How should retries work?', task: 'debug' })
})


it('merges overlapping screenshot uploads and replaces gap guidance with complete observed coverage', async () => {
  const observation = (startLine: number, lines: string[], endOfFile: boolean) => ({
    files: [{ path: 'src/orders.ts', language: 'typescript', startLine, lines, confidence: 0.95, endOfFile }],
    visiblePaths: ['src/orders.ts'], terminal: '', requirements: [],
  })
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ observation: observation(3, ['  publish();', '}'], true), model: 'vision-test' }))
    .mockResolvedValueOnce(Response.json({ observation: observation(1, ['export function cancelOrder() {', '  validate();', '  publish();'], false), model: 'vision-test' })))
  render(<Session />)
  const upload = screen.getByLabelText('Upload repository screenshot')
  fireEvent.change(upload, { target: { files: [new File(['first'], 'bottom.png', { type: 'image/png' })] } })
  await screen.findByText('1 captures · 1 files')
  expect(screen.getByText(/Open src\/orders.ts around line 1;/, { selector: 'span' })).toBeTruthy()
  expect(screen.getByText('2 observed lines · partial')).toBeTruthy()
  fireEvent.change(upload, { target: { files: [new File(['second'], 'top.png', { type: 'image/png' })] } })
  await screen.findByText('2 captures · 1 files')
  expect(screen.getByText('4 observed lines · continuous through visible EOF')).toBeTruthy()
  expect(screen.queryByText(/capture the missing region/)).toBeNull()
  expect(screen.getByText(/to inspect the observed implementation/, { selector: 'span' })).toBeTruthy()
})

it('shows the latest invalid-upload message, permits a valid retry, and clears the session', async () => {
  const observation = {
    files: [{ path: 'src/orders.ts', language: 'typescript', startLine: 1, lines: ['export function cancelOrder() {}'], confidence: 0.95, endOfFile: true }],
    visiblePaths: ['src/orders.ts'], terminal: '', requirements: [],
  }
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'Vision temporarily unavailable' }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ observation, model: 'vision-test' }))
  vi.stubGlobal('fetch', fetcher)
  render(<Session />)
  const upload = screen.getByLabelText('Upload repository screenshot')
  const valid = new File(['image'], 'editor.png', { type: 'image/png' })
  fireEvent.change(upload, { target: { files: [valid] } })
  await screen.findByText('Vision temporarily unavailable')
  fireEvent.change(upload, { target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] } })
  expect(screen.getByRole('alert').textContent).toContain('Choose a PNG, JPEG or WebP')
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.change(upload, { target: { files: [valid] } })
  await screen.findByText('1 captures · 1 files')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Clear screen repo' }))
  expect(screen.getByText('0 captures · 0 files')).toBeTruthy()
  expect(screen.queryByText('Observed code and gaps')).toBeNull()
  expect(screen.queryByText(/Vision: vision-test/)).toBeNull()
})

it('retries an unsuccessful analysis with its original question and task, then clears answer history without screenshots', async () => {
  const response = new Response('{"type":"delta","text":"Use one atomic state transition."}\n{"type":"done"}\n')
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Provider unavailable' }, { status: 503 })).mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetcher)
  render(<Session />)
  fireEvent.click(screen.getByRole('button', { name: 'review' }))
  await screen.findByText('Provider unavailable')
  fireEvent.change(screen.getByRole('textbox', { name: 'Current question' }), { target: { value: 'A different question?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }))
  await screen.findByText('Use one atomic state transition.')
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ question: 'Why does cancelOrder publish twice?', task: 'review' })
  fireEvent.click(screen.getByRole('button', { name: 'Clear screen repo' }))
  expect(screen.queryByRole('combobox', { name: 'Answer history' })).toBeNull()
  expect(screen.queryByText('Use one atomic state transition.')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('clearing the session cancels active analysis and removes partial answer state', async () => {
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Unfinished analysis"}\n')) },
    cancel,
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)))
  render(<Session />)
  fireEvent.click(screen.getByRole('button', { name: 'plan' }))
  await screen.findByText('Unfinished analysis')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear screen repo' })) })
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Unfinished analysis')).toBeNull()
  expect(screen.queryByRole('combobox', { name: 'Answer history' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect((screen.getByRole('button', { name: 'plan' }) as HTMLButtonElement).disabled).toBe(false)
})

it('aborts a delayed screenshot read on unmount and never uploads its late result', async () => {
  const readers: DelayedReader[] = []
  class DelayedReader {
    static LOADING = 1
    readyState = 0
    result: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    readAsDataURL() { this.readyState = 1; readers.push(this) }
    abort = vi.fn(() => { this.readyState = 2; this.onabort?.() })
  }
  vi.stubGlobal('FileReader', DelayedReader)
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'Unexpected request' }, { status: 502 }))
  vi.stubGlobal('fetch', fetcher)
  const { unmount } = render(<Session />)
  fireEvent.change(screen.getByLabelText('Upload repository screenshot'), { target: { files: [new File(['image'], 'editor.png', { type: 'image/png' })] } })
  expect(readers).toHaveLength(1)
  const reader = readers[0]
  const lateLoad = reader.onload
  unmount()
  await act(async () => {
    reader.result = 'data:image/png;base64,late-result'
    lateLoad?.()
    await Promise.resolve()
  })
  expect(reader.abort).toHaveBeenCalledTimes(1)
  expect(fetcher).not.toHaveBeenCalled()
})
