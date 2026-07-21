export function isShareValid(
  row: { shareToken: string | null; shareExpiresAt: Date | null },
  now: number,
): boolean {
  if (!row.shareToken || !row.shareExpiresAt) return false
  return row.shareExpiresAt.getTime() > now
}

export const SHARE_TTL_HOURS = { '1h': 1, '24h': 24, '7d': 168 } as const
export type ShareTtlKey = keyof typeof SHARE_TTL_HOURS
