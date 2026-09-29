// @vitest-environment node
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
const mock = vi.hoisted(() => ({ user: vi.fn(), rate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mock.user }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: mock.rate }))
import { POST } from './route'
const id = '2b92d2b4-2299-441d-8999-5c9bef381803'
const event = () => ({ v: 1, sessionId: id, operationId: id, seq: 1, at: Date.now(), stage: 'audio', event: 'ready', attrs: { channel: 'system', frames: 1 } })
const request = (body: unknown, extra = {}) => new Request('https://livetranscript.ai/api/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); mock.user.mockResolvedValue('private-user'); mock.rate.mockReturnValue(true); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
it('authenticates before reading or logging', async () => { mock.user.mockResolvedValue(null); expect((await POST(request({ events: [event()] }))).status).toBe(401); expect(console.info).not.toHaveBeenCalled() })
it('logs only validated client metadata with receipt time', async () => {
  const response = await POST(request({ events: [event()] }))
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ accepted: 1 })
  expect(console.info).toHaveBeenCalledTimes(1)
  const line = vi.mocked(console.info).mock.calls[0][0]
  expect(line).toContain('"origin":"client"'); expect(line).toContain('receivedAt'); expect(line).not.toContain('private-user')
})
it('rejects the entire batch before logging any private field', async () => {
  expect((await POST(request({ events: [event(), { ...event(), attrs: { message: 'SECRET' } }] }))).status).toBe(400)
  expect(console.info).not.toHaveBeenCalled(); expect(console.warn).not.toHaveBeenCalled()
})
it('limits batch size and blocks cross-origin uploads', async () => {
  expect((await POST(request({ events: Array.from({ length: 26 }, event) }))).status).toBe(400)
  expect((await POST(request({ events: [event()] }, { Origin: 'https://other.example' }))).status).toBe(403)
})
it('honors rate limits and rejects expired events', async () => {
  mock.rate.mockReturnValueOnce(false)
  expect((await POST(request({ events: [event()] }))).status).toBe(429)
  expect((await POST(request({ events: [{ ...event(), at: Date.now() - 86_400_001 }] }))).status).toBe(400)
})
it('bounds uploaded bytes, even without Content-Length', async () => {
  expect((await POST(request({ events: [event()], content: 'x'.repeat(33_000) }))).status).toBe(413)
  expect(console.info).not.toHaveBeenCalled()
})
