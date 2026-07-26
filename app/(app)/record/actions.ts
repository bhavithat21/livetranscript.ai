'use server'
import { getDb, sessions } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { posthogServer } from '@/lib/analytics'
import { sanitizeSegments } from '@/lib/transcript/store'
import { normalizeSummary } from '@/lib/summary'

// Share/revoke live in ../session-actions (shared with dashboard + detail);
// the record screen imports them from there directly.

type SaveInput = {
  title: string
  language: string
  durationSeconds: number
  segments: unknown
  summary: unknown
}

const MAX_TITLE_LEN = 200 // matches renameSession
const MAX_INT4 = 2_147_483_647 // duration_seconds is int4; clamp so a crafted value can't overflow the column

// Coerce an untrusted duration into a non-negative int within the int4 range.
function cleanDuration(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n), MAX_INT4)
}

export async function saveSession(input: SaveInput): Promise<{ id: string }> {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not authenticated')
  const db = getDb()
  if (!db) throw new Error('Database not configured')

  // Every field below is client-controlled; normalize before it reaches the DB
  // so a crafted/malformed payload can't store a shape the session page will
  // then crash rendering (summary.summary / keyPoints.map assume clean strings).
  const title = (typeof input.title === 'string' ? input.title.trim() : '').slice(0, MAX_TITLE_LEN)

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      title: title || 'Untitled session',
      language: typeof input.language === 'string' && input.language ? input.language.slice(0, 20) : 'en',
      durationSeconds: cleanDuration(input.durationSeconds),
      segments: sanitizeSegments(input.segments),
      summary: normalizeSummary(input.summary),
    })
    .returning({ id: sessions.id })

  posthogServer()?.capture({
    distinctId: userId,
    event: 'session_saved',
    properties: { sessionId: row.id },
  })
  return { id: row.id }
}
