import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { mintTranscriptionToken, TranscriptionTokenError } from '@/lib/transcription/token'
import { serverDiagnostic } from '@/lib/diagnostics/server'

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store', 'x-lt-retryable': 'false' } })
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ error: 'Same-origin required' }, { status: 403 })
  if (!rateLimit(`asr-token:${userId}`, 30, 60_000)) return Response.json({ error: 'Pause before reconnecting' }, { status: 429, headers: { 'Retry-After': '5' } })
  let provider: unknown
  try { const raw = await req.text(); if (raw.length > 200) throw new Error(); provider = JSON.parse(raw).provider }
  catch { return Response.json({ error: 'Invalid request' }, { status: 400 }) }
  if (provider !== 'deepgram' && provider !== 'assemblyai') return Response.json({ error: 'Unknown provider' }, { status: 400 })
  const started = Date.now()
  serverDiagnostic(req, 'transcription', 'start', { provider })
  try {
    const token = await mintTranscriptionToken(provider, req.signal)
    serverDiagnostic(req, 'transcription', 'success', { provider, durationMs: Date.now() - started })
    return Response.json(token, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof TranscriptionTokenError ? error.status : 502
    serverDiagnostic(req, 'transcription', 'error', { provider, httpStatus: status, code: error instanceof TranscriptionTokenError && !error.retryable ? 'provider_unavailable' : 'network' })
    return Response.json({ error: 'Transcription service could not connect. Check its access or try again.' }, { status, headers: { 'Cache-Control': 'no-store', 'x-lt-retryable': String(error instanceof TranscriptionTokenError ? error.retryable : !req.signal.aborted) } })
  }
}
