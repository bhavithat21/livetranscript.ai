'use server'
import { getDb, sessions } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { posthogServer } from '@/lib/analytics'
import { sanitizeSegments } from '@/lib/transcript/store'

// Share/revoke live in ../session-actions (shared with dashboard + detail);
// the record screen imports them from there directly.

type SaveInput = {
  title: string
  language: string
  durationSeconds: number
  segments: unknown
  summary: unknown
}

export async function saveSession(input: SaveInput): Promise<{ id: string }> {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not authenticated')
  const db = getDb()
  if (!db) throw new Error('Database not configured')

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      title: input.title || 'Untitled session',
      language: input.language || 'en',
      durationSeconds: input.durationSeconds,
      segments: sanitizeSegments(input.segments),
      summary: input.summary as object,
    })
    .returning({ id: sessions.id })

  posthogServer()?.capture({
    distinctId: userId,
    event: 'session_saved',
    properties: { sessionId: row.id },
  })
  return { id: row.id }
}
