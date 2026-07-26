import { NextRequest, NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'

// A session opens a couple of tokens (mint + fallback); allow a modest burst but
// cap so an account can't loop-mint provider tokens.
const TOKENS_PER_MINUTE = 20

// Mints short-lived, scoped tokens so the real provider API keys never reach the browser.
export async function POST(req: NextRequest) {
  // Require a signed-in user so anonymous callers can't burn our ASR quota.
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`asr-token:${userId}`, TOKENS_PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const provider = body.provider

  if (provider === 'assemblyai') {
    const key = process.env.ASSEMBLYAI_API_KEY
    if (!key) return NextResponse.json({ error: 'Engine unavailable' }, { status: 500 })
    // AssemblyAI streaming temp token (v3). Raw key in Authorization, NO Bearer prefix.
    const r = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=300', {
      headers: { Authorization: key },
    })
    if (!r.ok) return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
    const j = await r.json()
    return NextResponse.json({ token: j.token, expiresAt: Date.now() + 300_000 })
  }

  if (provider === 'deepgram') {
    const key = process.env.DEEPGRAM_API_KEY
    if (!key) return NextResponse.json({ error: 'Engine unavailable' }, { status: 500 })
    const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 300 }),
    })
    if (!r.ok) return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
    const j = await r.json()
    return NextResponse.json({ token: j.access_token, expiresAt: Date.now() + 300_000 })
  }

  return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
}
