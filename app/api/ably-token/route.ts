import { NextRequest, NextResponse } from 'next/server'
import Ably from 'ably'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { isStrongRoomId } from '@/lib/room/roomStore'
import { rateLimit } from '@/lib/rateLimit'

// Mints a short-lived Ably token so the real ABLY_API_KEY never reaches the browser.
// The token is scoped to the ONE room channel named in the request. There is no
// server-side room-membership model, so this does NOT prove the caller belongs in
// that room — any signed-in user who knows (or guesses) a room id can join it.
// We narrow that exposure two ways: the room id must clear the same strong-id bar
// the client generates (isStrongRoomId — blocks enumerating the friendly-id space),
// and each account is rate-limited so it can't loop-guess ids. Residual risk: a
// leaked/shared room id still grants access; a real membership table is the only
// full fix.
const MAX_ROOM_LEN = 64
const TOKENS_PER_MINUTE = 30

export async function GET(req: NextRequest) {
  // Only signed-in users can mint tokens (middleware also guards this).
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Per-user cap so one account can't loop-enumerate room ids to find live rooms.
  if (!rateLimit(`ably-token:${userId}`, TOKENS_PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const key = process.env.ABLY_API_KEY
  if (!key) return NextResponse.json({ error: 'Ably not configured' }, { status: 500 })

  // Enforce the strong-id rule server-side: reject weak/guessable ids outright so
  // the friendly-id keyspace can't be walked, and cap length before it names a channel.
  const room = req.nextUrl.searchParams.get('room') ?? ''
  if (!room || room.length > MAX_ROOM_LEN || !isStrongRoomId(room)) {
    return NextResponse.json({ error: 'Invalid room' }, { status: 400 })
  }

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
