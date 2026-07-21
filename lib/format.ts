// Small shared formatters for session UI.

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Which recency group a session falls into, relative to `now` (ms). Grouping the
// library by these buckets gives the dashboard a sense of time instead of a flat grid.
export type RecencyBucket = 'Today' | 'This week' | 'This month' | 'Earlier'

export function recencyBucket(d: Date | string, now: number): RecencyBucket {
  const t = (typeof d === 'string' ? new Date(d) : d).getTime()
  const days = (now - t) / 86_400_000
  if (days < 1) return 'Today'
  if (days < 7) return 'This week'
  if (days < 31) return 'This month'
  return 'Earlier'
}
