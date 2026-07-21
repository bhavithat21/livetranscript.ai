import { NextRequest, NextResponse } from 'next/server'
import Ably from 'ably'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'

// Mints a short-lived Ably token so the real ABLY_API_KEY never reaches the browser.
// The token is SCOPED to the one room channel the caller asked for — a token for
// room A cannot read or publish to room B (no wildcard access).
export async function GET(req: NextRequest) {
  // Defense-in-depth: only signed-in users can mint tokens, so an anonymous
  // caller can't enumerate room IDs and eavesdrop (middleware also guards this).
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.ABLY_API_KEY
  if (!key) return NextResponse.json({ error: 'Ably not configured' }, { status: 500 })

  const roomRaw = req.nextUrl.searchParams.get('room') ?? ''
  // Only allow safe channel-name chars; reject anything that could widen scope.
  const room = roomRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  if (!room) return NextResponse.json({ error: 'Missing room' }, { status: 400 })

  // Per-tab client id — required for Ably presence (roster + speaker-slot assignment).
  const clientIdRaw = req.nextUrl.searchParams.get('clientId') ?? ''
  const clientId = clientIdRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || undefined

  try {
    const client = new Ably.Rest(key)
    const token = await client.auth.requestToken({
      capability: JSON.stringify({ [`room:${room}`]: ['subscribe', 'publish', 'presence'] }),
      clientId,
      ttl: 3600_000, // 1 hour
    })
    return NextResponse.json(token)
  } catch (e) {
    logError('api/ably-token', e, { room })
    return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
  }
}
