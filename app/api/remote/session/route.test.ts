// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { currentUserId, rateLimit, requestToken, restConstructor } = vi.hoisted(() => ({
  currentUserId: vi.fn(), rateLimit: vi.fn(), requestToken: vi.fn(), restConstructor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ currentUserId, PREVIEW_NO_AUTH: false }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit }))
vi.mock('ably', () => ({ default: { Rest: class {
  auth = { requestToken }
  constructor(key: string) { restConstructor(key) }
} } }))

import { POST } from './route'

function request(body: unknown, extra: Record<string, string> = {}, url = 'https://app.example/api/remote/session') {
  return new Request(url, {
    method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('ABLY_API_KEY', 'ably.test:private-key')
  currentUserId.mockResolvedValue('owner')
  rateLimit.mockReturnValue(true)
  requestToken.mockImplementation(async ({ clientId, capability }) => ({ token: 'fake-provider-token', expires: Date.now() + 300_000, clientId, capability }))
})

describe('remote session API', () => {
  it('rejects cross-origin and anonymous callers before signing or contacting Ably', async () => {
    expect((await POST(request({ action: 'create' }, { origin: 'https://other.example' }))).status).toBe(403)
    expect((await POST(request({ action: 'create' }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    currentUserId.mockResolvedValue(null)
    expect((await POST(request({ action: 'create' }))).status).toBe(401)
    expect(restConstructor).not.toHaveBeenCalled()
  })

  it('returns private, expiring host/join grants and mints role-specific identified tokens', async () => {
    const create = await POST(request({ action: 'create' }))
    expect(create.status).toBe(200)
    expect(create.headers.get('cache-control')).toBe('no-store')
    const host = await create.json()
    expect(host).toMatchObject({ role: 'host', relayConfigured: false })
    expect(host.expiresAt - Date.now()).toBeGreaterThan(29 * 60_000)
    expect(JSON.stringify(host)).not.toContain('private-key')
    currentUserId.mockResolvedValue('helper')
    const join = await POST(request({ action: 'join', invite: host.invite }))
    const peer = await join.json()
    expect(peer).toMatchObject({ role: 'controller', roomId: host.roomId, hostClientId: host.clientId })
    expect(peer).not.toHaveProperty('invite')
    expect((await POST(request({ action: 'token', credential: peer.credential }))).status).toBe(200)
    expect(requestToken).toHaveBeenCalledWith({
      clientId: peer.clientId, ttl: 300_000,
      capability: JSON.stringify({ [`remote:${host.roomId}:requests`]: ['publish'], [`remote:${host.roomId}:peer:${peer.clientId}`]: ['subscribe'] }),
    })
    expect((await POST(request({ action: 'token', credential: host.credential }))).status).toBe(403)
    expect(requestToken).toHaveBeenCalledTimes(1)
  })

  it('refuses identity/channel overrides, invalid actions, malformed bodies and dishonest lengths', async () => {
    expect((await POST(request({ action: 'create', role: 'host', clientId: '*' }))).status).toBe(400)
    expect((await POST(request({ action: 'something' }))).status).toBe(400)
    expect((await POST(request({ action: 'join', invite: 'x'.repeat(5_000) }, { 'content-length': '1' }))).status).toBe(413)
    expect((await POST(request([], {}))).status).toBe(400)
    expect((await POST(request({ action: 'create' }, { 'content-type': 'text/plain' }))).status).toBe(415)
  })

  it('returns a clear unavailable/rate-limited state without fallback broad credentials', async () => {
    rateLimit.mockReturnValue(false)
    expect((await POST(request({ action: 'create' }))).status).toBe(429)
    rateLimit.mockReturnValue(true)
    vi.stubEnv('ABLY_API_KEY', '')
    const unavailable = await POST(request({ action: 'create' }))
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('cache-control')).toBe('no-store')
    expect(restConstructor).not.toHaveBeenCalled()
  })

  it('does not leak upstream authorization details on provider failure', async () => {
    const host = await (await POST(request({ action: 'create' }))).json()
    requestToken.mockRejectedValue(new Error('upstream failed with private-key and credential'))
    const response = await POST(request({ action: 'token', credential: host.credential }))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-key')
  })

  it('rejects provider tokens that omit required access or return a broader scope', async () => {
    const host = await (await POST(request({ action: 'create' }))).json()
    for (const capability of [JSON.stringify({ [`remote:${host.roomId}:requests`]: ['subscribe'] }), JSON.stringify({ '*': ['publish', 'subscribe'] })]) {
      requestToken.mockResolvedValue({ token: 'incorrect-scope-token', clientId: host.clientId, capability })
      const response = await POST(request({ action: 'token', credential: host.credential }))
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('incorrect-scope-token')
    }
  })
})
