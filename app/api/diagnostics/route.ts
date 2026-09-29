import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { parseDiagnosticEvent, sanitizeAttributes } from '@/lib/diagnostics/schema'

export const maxDuration = 10
const headers = { 'Cache-Control': 'no-store' }
export async function POST(req: Request) {
  const user = await currentUserId()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  if (req.headers.get('sec-fetch-site') === 'cross-site'
    || (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers })
  if (!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON required' }, { status: 415, headers })
  // Best-effort per-instance limiter; not a fleet-wide abuse guarantee.
  if (!rateLimit(`diagnostics:${user}`, 30, 60_000)) return Response.json({ error: 'Rate limited' }, { status: 429, headers: { ...headers, 'Retry-After': '60' } })
  try {
    const body = await readRepoJson(req, 32_000)
    if (Object.keys(body).length !== 1 || !Array.isArray(body.events) || !body.events.length || body.events.length > 25) throw new Error('Invalid batch')
    const events = body.events.map(parseDiagnosticEvent)
    if (events.some(item => item.at > Date.now() + 300_000 || Date.now() - item.at > 24 * 60 * 60 * 1000)) throw new Error('Expired batch')
    const release = sanitizeAttributes({ release: process.env.VERCEL_GIT_COMMIT_SHA })
    // Validate the complete batch BEFORE logging. No user id, IP or UA is copied.
    // Client observations are explicitly untrusted and have server receipt time.
    for (const event of events) {
      const line = '[lt-diagnostics] ' + JSON.stringify({ ...event, origin: 'client', receivedAt: Date.now(), server: release })
      if (event.event === 'error' || event.event === 'stall') console.warn(line)
      else console.info(line)
    }
    return Response.json({ accepted: events.length }, { headers })
  } catch (error) {
    return Response.json({ error: 'Invalid diagnostics batch' }, { status: error instanceof RepoRequestError ? error.status : 400, headers })
  }
}
