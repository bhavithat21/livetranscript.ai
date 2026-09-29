// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'
import { extractScreenEvidence, ScreenExtractionError } from '@/lib/repo/screenProvider'
vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn(async () => 'fixture') }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
vi.mock('@/lib/repo/modelPolicy', () => ({ repoModelFor: () => ({ model: 'claude-fixture' }) }))
vi.mock('@/lib/repo/screenProvider', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/repo/screenProvider')>(), extractScreenEvidence: vi.fn() }))
const request = () => new Request('https://app.test/api/copilot/repo-screen', { method: 'POST', body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=' }) })
beforeEach(() => vi.clearAllMocks())
it('does not multiply existing semantic validation retries', async () => {
  vi.mocked(extractScreenEvidence).mockRejectedValue(new ScreenExtractionError('Invalid evidence', 502, 'claude-fixture', undefined, 'invalid_lines', 2))
  const response = await POST(request())
  expect(response.status).toBe(502); expect(response.headers.get('x-lt-retryable')).toBe('false')
  expect(await response.json()).toEqual({ error: 'Invalid evidence' })
})
it('passes a retry delay without exposing raw provider errors', async () => {
  vi.mocked(extractScreenEvidence).mockRejectedValue(Object.assign(new Error('PRIVATE_ERROR'), { status: 429, headers: new Headers({ 'retry-after': '4' }) }))
  const response = await POST(request())
  expect(response.headers.get('x-lt-retryable')).toBe('true'); expect(response.headers.get('retry-after')).toBe('4')
  expect(await response.text()).not.toContain('PRIVATE_ERROR')
})
it('does not retry missing provider models', async () => {
  vi.mocked(extractScreenEvidence).mockRejectedValue(Object.assign(new Error('Missing'), { status: 404 }))
  expect((await POST(request())).headers.get('x-lt-retryable')).toBe('false')
})
