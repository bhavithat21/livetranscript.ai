// ponytail: in-memory per-instance token bucket. Best-effort — counts reset on
// deploy and each serverless instance keeps its own tally, so this slows abuse
// from one account (enumeration loops, quota drain); it does NOT hard-cap across
// a fleet. Swap for Redis/Upstash if you need a global limit.

type Bucket = { tokens: number; updatedAt: number }

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 10_000 // guard the map against unbounded growth from distinct keys

// Returns true if the call is allowed, false if `key` is over its rate. `limit`
// tokens refill linearly over `windowMs`; a full bucket permits a short burst.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const refillPerMs = limit / windowMs
  const b = buckets.get(key)
  if (!b) {
    if (buckets.size >= MAX_KEYS) pruneIdle(now, windowMs)
    buckets.set(key, { tokens: limit - 1, updatedAt: now })
    return true
  }
  const tokens = Math.min(limit, b.tokens + (now - b.updatedAt) * refillPerMs)
  b.updatedAt = now
  if (tokens < 1) {
    b.tokens = tokens
    return false
  }
  b.tokens = tokens - 1
  return true
}

// Drop fully-refilled (idle for a whole window) buckets so the map can't grow
// without bound; called lazily only when the map hits its cap.
function pruneIdle(now: number, windowMs: number): void {
  for (const [k, b] of buckets) {
    if (now - b.updatedAt >= windowMs) buckets.delete(k)
  }
}
