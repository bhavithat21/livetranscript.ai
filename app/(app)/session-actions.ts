'use server'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, sessions, newShareToken, type SessionRow } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { posthogServer } from '@/lib/analytics'
import { SHARE_TTL_HOURS } from '@/lib/share'
import { NoSessionContextError } from '@/lib/db/errors'

// Dashboard shows newest-first; cap the payload so a heavy account doesn't ship
// its entire library (incl. summary jsonb) in one Server Component response.
const LIST_LIMIT = 200

// The only share lifetimes the UI offers. A client can send any number, so we
// only honor these — anything else (NaN, 0, 100000) is rejected.
const ALLOWED_TTL_HOURS: readonly number[] = Object.values(SHARE_TTL_HOURS)

// Every post-save session operation lives here so the dashboard, the owner
// detail view, and the record screen all share one owner-scoped surface.
// (saveSession stays in record/actions.ts — it's part of the recording flow.)

async function requireUserDb() {
  const userId = await currentUserId()
  if (!userId) throw new NoSessionContextError('Not authenticated')
  const db = getDb()
  if (!db) throw new NoSessionContextError('Database not configured')
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
    .limit(LIST_LIMIT)
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
  // Never trust the client ttl — only mint links for the lifetimes the UI offers,
  // so a crafted request can't create a never-expiring or 0/NaN-expiry share.
  if (!ALLOWED_TTL_HOURS.includes(ttlHours)) throw new Error('Invalid share duration')
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
