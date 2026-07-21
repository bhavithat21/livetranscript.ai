import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

// Server-only. Lazy so the app builds and runs without DATABASE_URL (save/share
// features degrade gracefully); the connection is created on first real use.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (!_db) _db = drizzle(neon(url), { schema })
  return _db
}

export * from './schema'
