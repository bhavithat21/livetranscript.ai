// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), extract: vi.fn(), usage: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.user }))
vi.mock('@/lib/usage', () => ({ recordUsage: mocks.usage }))
vi.mock('@/lib/repo/modelPolicy', () => ({ repoModelFor: () => ({ model: 'claude-test' }) }))
vi.mock('@/lib/repo/screenProvider', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/repo/screenProvider')>(), extractScreenEvidence: mocks.extract }))
import { POST } from './route'
import { ScreenExtractionError } from '@/lib/repo/screenProvider'

const request = () => new Request('https://test.local/api/copilot/repo-screen', { method: 'POST', body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=' }), headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue('private-user-id') })
afterEach(() => vi.restoreAllMocks())
it('returns and logs an actionable category without raw provider data or user identity', async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.extract.mockRejectedValue(new ScreenExtractionError('SECRET PRIVATE PROVIDER PAYLOAD', 502, 'claude-test', undefined, 'format'))
  const response = await POST(request()), body = await response.json()
  expect(response.status).toBe(502)
  expect(body.code).toBe('format')
  expect(body.error).toContain('line numbers')
  const event = JSON.parse(log.mock.calls[0][0])
  expect(event).toMatchObject({ event: 'coach.screen.failed', code: 'format', model: 'claude-test' })
  expect(typeof event.requestId).toBe('string')
  expect(event.totalMs).toBeGreaterThanOrEqual(0)
  expect(JSON.stringify([body, log.mock.calls])).not.toMatch(/SECRET|private-user-id|iVBOR/)
})
it('classifies timeout and rate-limit errors while preserving authentication', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.extract.mockRejectedValue(Object.assign(new Error('private'), { name: 'APIConnectionTimeoutError' }))
  expect(await (await POST(request())).json()).toMatchObject({ code: 'timeout' })
  mocks.extract.mockRejectedValue({ status: 429, message: 'private' })
  const limited = await POST(request())
  expect(limited.status).toBe(429); expect(await limited.json()).toMatchObject({ code: 'rate' })
  mocks.user.mockResolvedValue(null); mocks.extract.mockClear()
  expect((await POST(request())).status).toBe(401)
  expect(mocks.extract).not.toHaveBeenCalled()
})
