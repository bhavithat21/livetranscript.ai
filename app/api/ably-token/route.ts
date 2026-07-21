import { NextResponse } from 'next/server'
import Ably from 'ably'

// Mints a short-lived Ably token so the real ABLY_API_KEY never reaches the browser.
export async function GET() {
  const key = process.env.ABLY_API_KEY
  if (!key) return NextResponse.json({ error: 'Ably not configured' }, { status: 500 })
  try {
    const client = new Ably.Rest(key)
    const token = await client.auth.requestToken()
    return NextResponse.json(token)
  } catch {
    return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
  }
}
