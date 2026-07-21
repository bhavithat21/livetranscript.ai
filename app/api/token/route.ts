import { NextRequest, NextResponse } from 'next/server'

// Mints short-lived, scoped tokens so the real provider API keys never reach the browser.
export async function POST(req: NextRequest) {
  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const provider = body.provider

  if (provider === 'assemblyai') {
    const key = process.env.ASSEMBLYAI_API_KEY
    if (!key) return NextResponse.json({ error: 'AssemblyAI key not configured' }, { status: 500 })
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
    if (!key) return NextResponse.json({ error: 'Deepgram key not configured' }, { status: 500 })
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
