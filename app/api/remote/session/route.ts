import Ably from 'ably'
import { currentUserId, PREVIEW_NO_AUTH } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import {
  assertRemoteTokenScope, createRemoteSession, joinRemoteSession, remoteCapabilities, remoteIceConfiguration,
  remoteSigningKey, remoteTokenTtl, verifyRemoteActor, RemoteAuthError,
} from '@/lib/remote/auth'
import type { RemoteSession } from '@/lib/remote/protocol'

export const runtime = 'nodejs'

const PRIVATE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const MAX_BODY_BYTES = 4_096

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS })
}

export async function POST(req: Request) {
  // Hosted Tauri uses this same web origin. No cross-origin or anonymous minting.
  const origin = req.headers.get('origin')
  if (!origin || origin !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: 'Open remote assistance from this app.' }, 403)
  }
  const userId = await currentUserId()
  if (!userId || PREVIEW_NO_AUTH) return json({ error: 'Sign in to use remote assistance.' }, 401)
  if (!rateLimit(`remote-session:${userId}`, 30, 60_000)) return json({ error: 'Too many requests. Try again in a minute.' }, 429)
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'JSON request required.' }, 415)
  const ablyKey = process.env.ABLY_API_KEY
  if (!ablyKey) return json({ error: 'Remote assistance needs an Ably connection. Ask the app owner to configure it.' }, 503)

  try {
    const body = await readRepoJson(req, MAX_BODY_BYTES)
    const key = remoteSigningKey()
    const allowed = body.action === 'create' ? ['action'] : body.action === 'join' ? ['action', 'invite'] : ['action', 'credential']
    if (Object.keys(body).some(field => !allowed.includes(field))) return json({ error: 'Unexpected request fields.' }, 400)
    if (body.action === 'token') {
      const actor = verifyRemoteActor(body.credential, userId, key)
      const client = new Ably.Rest(ablyKey)
      const token = await client.auth.requestToken({
        clientId: actor.clientId,
        capability: JSON.stringify(remoteCapabilities(actor)),
        ttl: remoteTokenTtl(actor),
      })
      assertRemoteTokenScope(token, actor)
      return json(token)
    }
    const session = body.action === 'create'
      ? createRemoteSession(userId, key)
      : body.action === 'join'
        ? joinRemoteSession(body.invite, userId, key)
        : null
    if (!session) return json({ error: 'Choose create, join, or token.' }, 400)
    const { claims, credential, invite, displayName } = session
    const result: RemoteSession = {
      roomId: claims.roomId, role: claims.role, clientId: claims.clientId,
      hostClientId: claims.hostClientId, credential, ...(invite ? { invite } : {}),
      expiresAt: claims.expiresAt, displayName,
      ...remoteIceConfiguration(userId, claims.expiresAt),
    }
    return json(result)
  } catch (error) {
    if (error instanceof RemoteAuthError || error instanceof RepoRequestError) return json({ error: error.message }, error.status)
    // SDK failures can contain authorization/request details. Do not log them.
    return json({ error: 'Remote signaling could not connect. Try again.' }, 502)
  }
}
