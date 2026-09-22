// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createRemoteSession, joinRemoteSession, remoteCapabilities, remoteIceConfiguration,
  remoteSigningKey, remoteTokenTtl, verifyRemoteActor,
} from './auth'
import { REMOTE_SESSION_MS, REMOTE_TOKEN_MS, remotePeerChannel, remoteRequestsChannel } from './protocol'

const NOW = 1_800_000_000_000
const key = remoteSigningKey({ ABLY_API_KEY: 'test.key:private-test-material' })

function payload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}
function signPayload(value: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}

describe('remote actor and invitation boundaries', () => {
  it('uses different unpredictable rooms, host identities, and controller identities', () => {
    const first = createRemoteSession('owner', key, NOW)
    const second = createRemoteSession('owner', key, NOW)
    const helper = joinRemoteSession(first.invite, 'helper', key, NOW + 100)
    const helperAgain = joinRemoteSession(first.invite, 'helper', key, NOW + 200)
    expect(first.claims.roomId).toMatch(/^[a-f0-9]{32}$/)
    expect(first.claims.roomId).not.toBe(second.claims.roomId)
    expect(first.claims.clientId).not.toBe(second.claims.clientId)
    expect(helper.claims.clientId).not.toBe(helperAgain.claims.clientId)
    expect(helper.claims.role).toBe('controller')
    expect(helper.invite).toBeUndefined()
    expect(helper.claims.hostClientId).toBe(first.claims.clientId)
    expect(helper.displayName).toBe(`Helper ${helper.claims.clientId.slice(-6).toUpperCase()}`)
    expect(payload(first.invite!)).not.toHaveProperty('userId')
  })

  it('binds actor credentials to the signed-in account and rejects role interchange', () => {
    const host = createRemoteSession('owner', key, NOW)
    const helper = joinRemoteSession(host.invite, 'helper', key, NOW)
    expect(verifyRemoteActor(host.credential, 'owner', key, NOW)).toEqual(host.claims)
    expect(verifyRemoteActor(helper.credential, 'helper', key, NOW)).toEqual(helper.claims)
    expect(() => verifyRemoteActor(host.credential, 'helper', key, NOW)).toThrow()
    expect(() => verifyRemoteActor(helper.credential, 'owner', key, NOW)).toThrow()
    expect(() => verifyRemoteActor(host.invite, 'owner', key, NOW)).toThrow()
    expect(() => joinRemoteSession(host.credential, 'helper', key, NOW)).toThrow()
    expect(() => joinRemoteSession(helper.credential, 'other', key, NOW)).toThrow()
  })

  it('rejects forged contents, wrong signing keys, and non-canonical signatures', () => {
    const host = createRemoteSession('owner', key, NOW)
    const [body, signature] = host.credential.split('.')
    const changed = Buffer.from(JSON.stringify({ ...payload(host.credential), userId: 'attacker' })).toString('base64url')
    expect(() => verifyRemoteActor(`${changed}.${signature}`, 'attacker', key, NOW)).toThrow()
    expect(() => verifyRemoteActor(host.credential, 'owner', Buffer.alloc(32), NOW)).toThrow()
    expect(() => verifyRemoteActor(`${body}.${signature}=`, 'owner', key, NOW)).toThrow()
    expect(() => verifyRemoteActor('x'.repeat(3_000), 'owner', key, NOW)).toThrow()
    expect(() => verifyRemoteActor(null, 'owner', key, NOW)).toThrow()
  })

  it('keeps late joins and token refreshes inside the original 30-minute session', () => {
    const host = createRemoteSession('owner', key, NOW)
    const helper = joinRemoteSession(host.invite, 'helper', key, NOW + REMOTE_SESSION_MS - 500)
    expect(helper.claims.expiresAt).toBe(NOW + REMOTE_SESSION_MS)
    expect(remoteTokenTtl(host.claims, NOW)).toBe(REMOTE_TOKEN_MS)
    expect(remoteTokenTtl(helper.claims, NOW + REMOTE_SESSION_MS - 500)).toBe(500)
    expect(() => remoteTokenTtl(host.claims, host.claims.expiresAt)).toThrow()
    expect(() => verifyRemoteActor(host.credential, 'owner', key, host.claims.expiresAt)).toThrow()
    expect(() => joinRemoteSession(host.invite, 'helper', key, host.claims.expiresAt)).toThrow()
  })

  it('rejects internally malformed signed claims instead of trusting parsed JSON', () => {
    const host = createRemoteSession('owner', key, NOW)
    const base = payload(host.credential)
    for (const change of [
      { aud: 'different-protocol' }, { roomId: '*' }, { clientId: 'c_000000000000000000000000' },
      { role: 'admin' }, { hostClientId: '*' }, { expiresAt: NOW + REMOTE_SESSION_MS + 1 },
      { issuedAt: NOW + 6_000 }, { expiresAt: NOW }, { userId: '' },
    ]) expect(() => verifyRemoteActor(signPayload({ ...base, ...change }), 'owner', key, NOW)).toThrow()
  })

  it('prevents helper impersonation and cross-peer/channel subscriptions with exact capabilities', () => {
    const host = createRemoteSession('owner', key, NOW)
    const helper = joinRemoteSession(host.invite, 'helper', key, NOW)
    expect(remoteCapabilities(host.claims)).toEqual({
      [remoteRequestsChannel(host.claims.roomId)]: ['subscribe'],
      [`remote:${host.claims.roomId}:peer:*`]: ['publish'],
    })
    expect(remoteCapabilities(helper.claims)).toEqual({
      [remoteRequestsChannel(host.claims.roomId)]: ['publish'],
      [remotePeerChannel(host.claims.roomId, helper.claims.clientId)]: ['subscribe'],
    })
    expect(JSON.stringify(remoteCapabilities(helper.claims))).not.toContain('*')
    expect(() => remotePeerChannel(host.claims.roomId, host.claims.clientId)).toThrow()
    expect(() => remoteRequestsChannel('room:*')).toThrow()
  })

  it('separates signing keys and refuses a weak explicit override', () => {
    expect(key.equals(Buffer.from('test.key:private-test-material'))).toBe(false)
    expect(remoteSigningKey({ ABLY_API_KEY: 'another-key' }).equals(key)).toBe(false)
    expect(() => remoteSigningKey({ REMOTE_SESSION_SECRET: 'short', ABLY_API_KEY: 'present' })).toThrow()
    expect(() => remoteSigningKey({})).toThrow()
  })
})

describe('remote ICE configuration', () => {
  it('reports the absence of a relay instead of promising cross-network connectivity', () => {
    expect(remoteIceConfiguration('owner', NOW, {})).toEqual({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], relayConfigured: false,
    })
  })

  it('issues account-specific expiring TURN REST credentials without exposing the signing secret', () => {
    const env = { REMOTE_TURN_URLS: 'turn:relay.example:3478,turns:relay.example:5349?transport=tcp', REMOTE_TURN_SECRET: 'example-private-relay-secret' }
    const first = remoteIceConfiguration('owner', NOW, env)
    const second = remoteIceConfiguration('helper', NOW, env)
    const relay = first.iceServers[1]
    expect(first.relayConfigured).toBe(true)
    expect(relay.username).toMatch(/^1800000000:[a-f0-9]{16}$/)
    expect(relay.credential).toBe(createHmac('sha1', env.REMOTE_TURN_SECRET).update(relay.username!).digest('base64'))
    expect(second.iceServers[1].username).not.toBe(relay.username)
    expect(JSON.stringify(first)).not.toContain(env.REMOTE_TURN_SECRET)
    expect(JSON.stringify(first)).not.toContain('owner')
  })

  it('accepts explicitly configured static relay credentials and valid IPv6 addresses', () => {
    expect(remoteIceConfiguration('owner', NOW, {
      REMOTE_TURN_URLS: 'turn:[::1]:3478?transport=udp', REMOTE_TURN_USERNAME: 'configured', REMOTE_TURN_CREDENTIAL: 'private',
    }).iceServers[1]).toEqual({ urls: ['turn:[::1]:3478?transport=udp'], username: 'configured', credential: 'private' })
  })

  it('fails clearly for partially configured or malformed relays', () => {
    for (const url of ['https://relay.example', 'turn:user:secret@relay.example', 'turn:::', 'turn:relay.example:99999', 'turn:relay.example#fragment']) {
      expect(() => remoteIceConfiguration('owner', NOW, { REMOTE_TURN_URLS: url, REMOTE_TURN_USERNAME: 'user', REMOTE_TURN_CREDENTIAL: 'secret' })).toThrow()
    }
    expect(() => remoteIceConfiguration('owner', NOW, { REMOTE_TURN_URLS: 'turn:relay.example' })).toThrow()
  })
})
