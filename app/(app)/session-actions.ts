'use server'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, sessions, newShareToken, type SessionRow } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { posthogServer } from '@/lib/analytics'

// Every post-save session operation lives here so the dashboard, the owner
// detail view, and the record screen all share one owner-scoped surface.
// (saveSession stays in record/actions.ts — it's part of the recording flow.)

async function requireUserDb() {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not authenticated')
  const db = getDb()
  if (!db) throw new Error('Database not configured')
  return { userId, db }
}

// Card-sized rows: everything the library needs EXCEPT the heavy segments blob.
export type SessionSummaryRow = Pick<
  SessionRow,
  'id' | 'title' | 'durationSeconds' | 'createdAt' | 'shareToken' | 'shareExpiresAt' | 'summary'
>

export async function listSessions(): Promise<SessionSummaryRow[]> {
  const { userId, db } = await requireUserDb()
  return db
    .select({
      id: sessions.id,
      title: sessions.title,
      durationSeconds: sessions.durationSeconds,
      createdAt: sessions.createdAt,
      shareToken: sessions.shareToken,
      shareExpiresAt: sessions.shareExpiresAt,
      summary: sessions.summary,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
}

// Full row (incl. segments) for the owner detail view. Null if not theirs.
export async function getSession(id: string): Promise<SessionRow | null> {
  const { userId, db } = await requireUserDb()
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function renameSession(id: string, title: string): Promise<void> {
  const { userId, db } = await requireUserDb()
  const clean = title.trim().slice(0, 200) || 'Untitled session'
  await db
    .update(sessions)
    .set({ title: clean, updatedAt: new Date() })
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
}

export async function deleteSession(id: string): Promise<void> {
  const { userId, db } = await requireUserDb()
  await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
  posthogServer()?.capture({ distinctId: userId, event: 'session_deleted', properties: { id } })
}

export async function createShare(sessionId: string, ttlHours: number): Promise<{ url: string }> {
  const { userId, db } = await requireUserDb()
  const token = newShareToken()
  const expires = new Date(Date.now() + ttlHours * 3_600_000)
  const updated = await db
    .update(sessions)
    .set({ shareToken: token, shareExpiresAt: expires, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id })
  if (!updated.length) throw new Error('Session not found')

  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return { url: `${base}/s/${token}` }
}

export async function revokeShare(sessionId: string): Promise<void> {
  const { userId, db } = await requireUserDb()
  await db
    .update(sessions)
    .set({ shareToken: null, shareExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
}
