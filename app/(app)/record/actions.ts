'use server'
import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import { getDb, sessions, newShareToken } from '@/lib/db'
import { posthogServer } from '@/lib/analytics'

type SaveInput = {
  title: string
  language: string
  durationSeconds: number
  segments: unknown
  summary: unknown
}

export async function saveSession(input: SaveInput): Promise<{ id: string }> {
  const { userId } = await auth()
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
      segments: input.segments as object,
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

export async function createShare(sessionId: string, ttlHours: number): Promise<{ url: string }> {
  const { userId } = await auth()
  if (!userId) throw new Error('Not authenticated')
  const db = getDb()
  if (!db) throw new Error('Database not configured')

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
  const { userId } = await auth()
  if (!userId) throw new Error('Not authenticated')
  const db = getDb()
  if (!db) throw new Error('Database not configured')

  await db
    .update(sessions)
    .set({ shareToken: null, shareExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
}
