// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as capture } from '@/app/api/copilot/repo-screen/route'
import { POST as analyze } from '@/app/api/copilot/repo-analyze/route'
import { emptyScreenSnapshot, mergeScreenObservation, screenContext, screenNavigation, type ScreenObservation } from './screenEvidence'

// Real routes, parsing, reconstruction, providers, orchestration and wire format.
// Only authentication/telemetry and the external model SDK boundary are replaced.
vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn(async () => 'test-user') }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
const provider = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = provider } }))

const image = 'data:image/png;base64,iVBORw0KGgo='
const question = 'Why does cancelling an order publish twice, and which file should I open?'
const observations: ScreenObservation[] = [
  {
    files: [{ path: 'src/orders.ts', language: 'typescript', startLine: 10, lines: ['export function cancel(id: string) {', '  store.cancel(id);', '  publish(id);', '}'], confidence: 0.97, endOfFile: false }],
    visiblePaths: ['src/orders.ts', 'src/store.ts', 'tests/orders.test.ts'],
    requirements: ['Cancellation must emit one event even when retried.'], terminal: 'FAIL duplicate cancellation event',
  },
  {
    files: [{ path: 'src/store.ts', language: 'typescript', startLine: 1, lines: ['export function cancel(id: string) {', '  return updateIfActive(id);', '}'], confidence: 0.97, endOfFile: true }],
    visiblePaths: ['src/store.ts'], requirements: [], terminal: '',
  },
]
const request = (body: unknown) => new Request('https://app.test/api/copilot/repo-analyze', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  vi.stubEnv('COPILOT_REPO_BENCHMARK_POLICY', '')
  for (const role of ['VISION', 'REQUIREMENTS', 'IMPLEMENTATION', 'DEBUGGER', 'REVIEWER', 'SYNTHESIS']) vi.stubEnv(`COPILOT_REPO_MODEL_${role}`, 'claude-test')
})
afterEach(() => vi.unstubAllEnvs())

describe('repository product API journey', () => {
  it.each([false, true])('carries two captured files into independent specialists and synthesis (reviewer unavailable: %s)', async (reviewerUnavailable) => {
    let screenIndex = 0
    provider.create.mockImplementation(async ({ system }: { system: string }) => {
      if (system.startsWith('Transcribe visible repository evidence')) {
        return { model: 'claude-vision-actual', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(observations[screenIndex++]) }] }
      }
      if (reviewerUnavailable && system.includes('independent adversarial reviewer')) throw new Error('private provider diagnostic')
      return { model: 'claude-specialist-actual', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Observed src/orders.ts:12 publishes unconditionally; inspect src/store.ts:2 return value. Tests have not been run.' }] }
    })
    provider.stream.mockImplementation(async function* () {
      yield { type: 'message_start', message: { model: 'claude-synthesis-actual' } }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '## Navigate\nOpen src/orders.ts:10 and src/store.ts:2.\n## Verification\nRun the retry test; no tests were executed by this service.' } }
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
      yield { type: 'message_stop' }
    })

    let snapshot = emptyScreenSnapshot()
    for (let index = 0; index < observations.length; index++) {
      const response = await capture(request({ image }))
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.model).toBe('claude-vision-actual')
      snapshot = mergeScreenObservation(snapshot, result.observation)
    }
    expect(snapshot.files.map((file) => file.path)).toEqual(['src/orders.ts', 'src/store.ts'])
    expect(screenNavigation(snapshot, question)).toContainEqual(expect.objectContaining({ path: 'src/orders.ts', instruction: expect.stringContaining('line 1') }))
    const context = screenContext(snapshot, question)
    expect(context).toContain('MISSING lines 1-9')

    const response = await analyze(request({ question, context, transcript: 'Please explain the root cause and make retries safe.', task: 'debug' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent', role: 'reviewer', status: reviewerUnavailable ? 'failed' : 'done' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent', role: 'synthesis', status: 'done', model: 'claude-synthesis-actual' }))
    expect(JSON.stringify(events)).not.toContain('private provider diagnostic')
    expect(provider.create).toHaveBeenCalledTimes(5)

    const synthesis = JSON.parse(provider.stream.mock.calls[0][0].messages[0].content)
    expect(synthesis.sourceEvidence.repositoryEvidence).toBe(context)
    expect(synthesis.sourceEvidence.question).toBe(question)
    expect(synthesis.specialistReports.map((report: { role: string }) => report.role)).toEqual(['requirements', 'debugger', 'reviewer'])
    expect(synthesis.specialistReports.find((report: { role: string }) => report.role === 'reviewer').status).toBe(reviewerUnavailable ? 'failed' : 'done')
  })

  it('preserves a partial answer but never emits done after the model stream ends prematurely', async () => {
    provider.create.mockResolvedValue({ model: 'claude-specialist-actual', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Inspect the captured caller.' }] })
    provider.stream.mockImplementation(async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial proposed fix' } }
    })
    const response = await analyze(request({ question, context: 'src/orders.ts:12 publish(id)', task: 'debug' }))
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(events).toContainEqual({ type: 'delta', text: 'Partial proposed fix' })
    expect(events).toContainEqual(expect.objectContaining({ role: 'synthesis', status: 'failed' }))
    expect(events.at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('incomplete') })
    expect(events.some((event) => event.type === 'done')).toBe(false)
  })
})
