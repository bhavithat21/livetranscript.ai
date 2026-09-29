import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { serverDiagnostic } from '@/lib/diagnostics/server'
import { runPreflight } from '@/lib/reliability/preflight'
export const maxDuration = 60
/** Explicit, authenticated, bounded synthetic requests; never arbitrary prompts. */
export async function POST(req: Request) {
  const user = await currentUserId()
  if (!user) return Response.json({ error: 'Sign in before checking model access.' }, { status: 401 })
  if (req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ error: 'Same-origin request required' }, { status: 403 })
  if (!rateLimit(`preflight:${user}`, 1, 60_000)) return Response.json({ error: 'Wait one minute before running another check.' }, { status: 429, headers: { 'Retry-After': '60' } })
  const report = await runPreflight(AbortSignal.any([req.signal, AbortSignal.timeout(50_000)]))
  for (const check of report.checks) serverDiagnostic(req, 'app', check.status === 'failed' ? 'error' : 'success', { model: check.model, code: check.code, durationMs: check.durationMs })
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } })
}
