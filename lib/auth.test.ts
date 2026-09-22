import { afterEach, describe, expect, it, vi } from 'vitest'
const clerkAuth = vi.hoisted(() => vi.fn())
vi.mock('@clerk/nextjs/server', () => ({ auth: clerkAuth }))
import { currentUserId } from './auth'
afterEach(() => { vi.unstubAllEnvs(); clerkAuth.mockReset() })
describe('server identity configuration', () => {
  it('denies access without invoking missing middleware when Clerk is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '')
    expect(await currentUserId()).toBeNull()
    expect(clerkAuth).not.toHaveBeenCalled()
  })
  it('requires Clerk identity when configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_fixture')
    clerkAuth.mockResolvedValue({ userId: null })
    expect(await currentUserId()).toBeNull()
    clerkAuth.mockResolvedValue({ userId: 'owner-1' })
    expect(await currentUserId()).toBe('owner-1')
  })
})
