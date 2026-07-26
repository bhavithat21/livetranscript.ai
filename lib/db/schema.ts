import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull().default('Untitled session'),
    language: text('language').notNull().default('en'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    segments: jsonb('segments').notNull().default([]),
    summary: jsonb('summary'),
    shareToken: text('share_token').unique(),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // listSessions filters by user_id and orders by created_at desc — this composite
  // index serves both. Requires a migration (drizzle-kit push/generate) on deploy.
  (t) => [index('sessions_user_created_idx').on(t.userId, t.createdAt.desc())],
)

export type SessionRow = typeof sessions.$inferSelect

// url-safe token from 16 random bytes -> 22 base64url chars
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
