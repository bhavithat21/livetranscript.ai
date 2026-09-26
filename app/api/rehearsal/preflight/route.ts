import { currentUserId } from '@/lib/auth'
import { rehearsalEnabled, rehearsalPreflight } from '@/lib/rehearsal/preflight'
export async function POST(req: Request) {
  if (!rehearsalEnabled()) return Response.json({ error: 'Rehearsal is disabled outside explicitly enabled non-production environments.' }, { status: 404 })
  if (!await currentUserId()) return Response.json({ error: 'Sign in to the test environment.' }, { status: 401 })
  if (req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ error: 'Same-origin request required.' }, { status: 403 })
  return Response.json(rehearsalPreflight(), { headers: { 'Cache-Control':'no-store' } })
}
