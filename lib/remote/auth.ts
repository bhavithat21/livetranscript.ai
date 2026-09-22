import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import {
  REMOTE_CLIENT_PATTERN, REMOTE_ID_PATTERN, REMOTE_SESSION_MS, REMOTE_TOKEN_MS,
  remoteDisplayName, remotePeerChannel, remoteRequestsChannel, type RemoteRole,
} from './protocol'

const CREDENTIAL_AUDIENCE = 'livetranscript.remote.v1'
const MAX_CREDENTIAL_LENGTH = 2_048
const CLOCK_TOLERANCE_MS = 5_000

type CommonClaims = {
  aud: typeof CREDENTIAL_AUDIENCE
  roomId: string
  hostClientId: string
  issuedAt: number
  expiresAt: number
}

export type RemoteActorClaims = CommonClaims & {
  kind: 'actor'
  role: RemoteRole
  userId: string
  clientId: string
}
type RemoteInviteClaims = CommonClaims & { kind: 'invite' }
type RemoteClaims = RemoteActorClaims | RemoteInviteClaims
export type RemoteCredentials = {
  claims: RemoteActorClaims
  credential: string
  invite?: string
  displayName: string
}

export class RemoteAuthError extends Error {
  constructor(message = 'This remote invitation or session has expired. Start a new session.', public status = 403) {
    super(message)
  }
}

/** Derivation keeps these signatures separate from Ably's token signatures. */
export function remoteSigningKey(env: Partial<NodeJS.ProcessEnv> = process.env): Buffer {
  const dedicated = env.REMOTE_SESSION_SECRET
  if (dedicated !== undefined && Buffer.byteLength(dedicated) < 32) {
    throw new RemoteAuthError('Remote session signing is not configured correctly.', 503)
  }
  const source = dedicated || env.ABLY_API_KEY
  if (!source) throw new RemoteAuthError('Remote assistance is not configured.', 503)
  return createHmac('sha256', source).update(`${CREDENTIAL_AUDIENCE}.credential-signing`).digest()
}

function sign(claims: RemoteClaims, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

function verify(token: unknown, key: Buffer, now: number): RemoteClaims {
  if (typeof token !== 'string' || token.length > MAX_CREDENTIAL_LENGTH) throw new RemoteAuthError()
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) throw new RemoteAuthError()
  const signature = Buffer.from(match[2], 'base64url')
  const expected = createHmac('sha256', key).update(match[1]).digest()
  if (signature.toString('base64url') !== match[2] || signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new RemoteAuthError()
  let value: unknown
  try { value = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) } catch { throw new RemoteAuthError() }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteAuthError()
  const claims = value as Record<string, unknown>
  if (claims.aud !== CREDENTIAL_AUDIENCE || !['invite', 'actor'].includes(String(claims.kind)) ||
    typeof claims.roomId !== 'string' || !REMOTE_ID_PATTERN.test(claims.roomId) ||
    typeof claims.hostClientId !== 'string' || !/^h_[a-f0-9]{24}$/.test(claims.hostClientId) ||
    typeof claims.issuedAt !== 'number' || !Number.isSafeInteger(claims.issuedAt) ||
    typeof claims.expiresAt !== 'number' || !Number.isSafeInteger(claims.expiresAt) ||
    claims.issuedAt > now + CLOCK_TOLERANCE_MS || claims.expiresAt <= now ||
    claims.expiresAt <= claims.issuedAt || claims.expiresAt - claims.issuedAt > REMOTE_SESSION_MS) {
    throw new RemoteAuthError()
  }
  if (claims.kind === 'actor') {
    if ((claims.role !== 'host' && claims.role !== 'controller') ||
      typeof claims.userId !== 'string' || !claims.userId || claims.userId.length > 256 ||
      typeof claims.clientId !== 'string' || !REMOTE_CLIENT_PATTERN.test(claims.clientId) ||
      (claims.role === 'host' ? claims.clientId !== claims.hostClientId : !claims.clientId.startsWith('c_'))) {
      throw new RemoteAuthError()
    }
  }
  return value as RemoteClaims
}

function validUser(userId: string): void {
  if (!userId || userId.length > 256) throw new RemoteAuthError('Sign in to use remote assistance.', 401)
}

export function createRemoteSession(userId: string, key: Buffer, now = Date.now()): RemoteCredentials {
  validUser(userId)
  const hostClientId = `h_${randomBytes(12).toString('hex')}`
  const common: CommonClaims = {
    aud: CREDENTIAL_AUDIENCE,
    roomId: randomBytes(16).toString('hex'),
    hostClientId,
    issuedAt: now,
    expiresAt: now + REMOTE_SESSION_MS,
  }
  const claims: RemoteActorClaims = { ...common, kind: 'actor', role: 'host', userId, clientId: hostClientId }
  return {
    claims, credential: sign(claims, key),
    invite: sign({ ...common, kind: 'invite' }, key),
    displayName: remoteDisplayName(hostClientId),
  }
}

export function joinRemoteSession(invite: unknown, userId: string, key: Buffer, now = Date.now()): RemoteCredentials {
  validUser(userId)
  const invitation = verify(invite, key, now)
  if (invitation.kind !== 'invite') throw new RemoteAuthError()
  const claims: RemoteActorClaims = {
    ...invitation, kind: 'actor', role: 'controller', userId,
    clientId: `c_${randomBytes(12).toString('hex')}`,
  }
  return { claims, credential: sign(claims, key), displayName: remoteDisplayName(claims.clientId) }
}

export function verifyRemoteActor(credential: unknown, userId: string, key: Buffer, now = Date.now()): RemoteActorClaims {
  validUser(userId)
  const actor = verify(credential, key, now)
  if (actor.kind !== 'actor' || actor.userId !== userId) throw new RemoteAuthError()
  return actor
}

export function remoteCapabilities(actor: RemoteActorClaims): Record<string, ('publish' | 'subscribe')[]> {
  return actor.role === 'host' ? {
    [remoteRequestsChannel(actor.roomId)]: ['subscribe'],
    [`remote:${actor.roomId}:peer:*`]: ['publish'],
  } : {
    [remoteRequestsChannel(actor.roomId)]: ['publish'],
    [remotePeerChannel(actor.roomId, actor.clientId)]: ['subscribe'],
  }
}

export function remoteTokenTtl(actor: RemoteActorClaims, now = Date.now()): number {
  const ttl = Math.min(REMOTE_TOKEN_MS, actor.expiresAt - now)
  if (ttl <= 0) throw new RemoteAuthError()
  return ttl
}

/** Ably intersects requested and API-key capabilities; success can still omit access. */
export function assertRemoteTokenScope(token: { clientId?: string; capability: string }, actor: RemoteActorClaims): void {
  let actual: unknown
  try { actual = JSON.parse(token.capability) } catch { actual = null }
  const required = remoteCapabilities(actor)
  if (token.clientId !== actor.clientId || !actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new RemoteAuthError('Remote signaling permissions are not configured correctly.', 503)
  }
  const capabilities = actual as Record<string, unknown>
  const paths = Object.keys(required)
  if (Object.keys(capabilities).length !== paths.length || paths.some(path => {
    const operations = capabilities[path]
    return !Array.isArray(operations) || operations.length !== required[path].length ||
      required[path].some(operation => !operations.includes(operation))
  })) throw new RemoteAuthError('Remote signaling permissions are not configured correctly.', 503)
}

export function remoteIceConfiguration(userId: string, expiresAt: number, env: Partial<NodeJS.ProcessEnv> = process.env): {
  iceServers: RTCIceServer[]; relayConfigured: boolean
} {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  const urls = (env.REMOTE_TURN_URLS || '').split(/[\s,]+/).filter(Boolean)
  if (urls.length === 0) return { iceServers, relayConfigured: false }
  const validTurnUrl = (url: string) => {
    if (url.length > 512 || !/^turns?:[a-zA-Z0-9.\-\[\]:]+(?:\?transport=(?:udp|tcp))?$/.test(url)) return false
    try { return Boolean(new URL(`http://${url.replace(/^turns?:/, '')}`).hostname) } catch { return false }
  }
  if (urls.length > 4 || urls.some(url => !validTurnUrl(url))) {
    throw new RemoteAuthError('Remote relay URLs are not configured correctly.', 503)
  }
  let username: string
  let credential: string
  if (env.REMOTE_TURN_SECRET) {
    if (env.REMOTE_TURN_SECRET.length < 16) throw new RemoteAuthError('Remote relay signing is not configured correctly.', 503)
    const account = createHash('sha256').update(userId).digest('hex').slice(0, 16)
    username = `${Math.ceil(expiresAt / 1_000)}:${account}`
    credential = createHmac('sha1', env.REMOTE_TURN_SECRET).update(username).digest('base64')
  } else {
    username = env.REMOTE_TURN_USERNAME || ''
    credential = env.REMOTE_TURN_CREDENTIAL || ''
    if (!username || !credential) throw new RemoteAuthError('Remote relay credentials are not configured.', 503)
  }
  iceServers.push({ urls, username, credential })
  return { iceServers, relayConfigured: true }
}
