import { NextRequest, NextResponse } from 'next/server'
import Ably from 'ably'

// Mints a short-lived Ably token so the real ABLY_API_KEY never reaches the browser.
// The token is SCOPED to the one room channel the caller asked for — a token for
// room A cannot read or publish to room B (no wildcard access).
export async function GET(req: NextRequest) {
  const key = process.env.ABLY_API_KEY
  if (!key) return NextResponse.json({ error: 'Ably not configured' }, { status: 500 })

  const roomRaw = req.nextUrl.searchParams.get('room') ?? ''
  // Only allow safe channel-name chars; reject anything that could widen scope.
  const room = roomRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  if (!room) return NextResponse.json({ error: 'Missing room' }, { status: 400 })

  try {
    const client = new Ably.Rest(key)
    const token = await client.auth.requestToken({
      capability: JSON.stringify({ [`room:${room}`]: ['subscribe', 'publish', 'presence'] }),
      ttl: 3600_000, // 1 hour
    })
    return NextResponse.json(token)
  } catch {
    return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
  }
}
