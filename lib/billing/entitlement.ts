// Entitlement — the single source of truth for what a user is allowed to do.
// SERVER-ONLY (reads secret env). Designed so nobody can grant themselves paid/
// unlimited access without controlling the deploy environment.
//
// Owner free-forever access is an ENV ALLOWLIST, not a DB flag: a compromised
// DB write, a bad migration, or an admin endpoint can't escalate anyone — the
// only way to be unlimited is to be listed in OWNER_USER_IDS in Vercel env.
// The userId compared here comes from Clerk's verified session (currentUserId),
// so it can't be spoofed from a request body.

// Billing is OFF until Stripe is live. While off, everyone transcribes freely
// (the app keeps working); flip BILLING_ENABLED=1 only once checkout exists.
export const BILLING_ENABLED = process.env.BILLING_ENABLED === '1'

export type Plan = 'unlimited' | 'member' | 'payg' | 'free'

export interface Entitlement {
  plan: Plan
  unlimited: boolean // skips all credit checks
  billingEnabled: boolean // whether gating is active at all yet
}

// Owner allowlist — comma-separated Clerk user ids in server env only.
function ownerIds(): string[] {
  return (process.env.OWNER_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isOwner(userId: string | null | undefined): boolean {
  if (!userId) return false
  return ownerIds().includes(userId)
}

// Fails CLOSED: unknown users are 'free', never unlimited. Owners are always
// unlimited (independent of billing state). Until billing is enabled, everyone
// is treated as unlimited so the live product isn't broken before payments ship.
export function getEntitlement(userId: string | null | undefined): Entitlement {
  if (isOwner(userId)) return { plan: 'unlimited', unlimited: true, billingEnabled: BILLING_ENABLED }
  if (!BILLING_ENABLED) return { plan: 'free', unlimited: true, billingEnabled: false }
  // Billing on, non-owner: real plan/credits will come from Neon here later.
  return { plan: 'free', unlimited: false, billingEnabled: true }
}
