import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUser } from '@clerk/nextjs'
import { DisplayNameBridge, useDisplayName } from './useDisplayName'
import type { ReactNode } from 'react'

vi.mock('@clerk/nextjs', () => ({ useUser: vi.fn() }))

beforeEach(() => { vi.resetAllMocks() })

describe('display-name provider boundaries', () => {
  it('does not invoke Clerk when the app is in provider-free preview mode', () => {
    const { result } = renderHook(useDisplayName, { wrapper: ({ children }: { children: ReactNode }) => <DisplayNameBridge clerkConfigured={false}>{children}</DisplayNameBridge> })
    expect(result.current).toBeUndefined()
    expect(useUser).not.toHaveBeenCalled()
  })

  it('reads the signed-in name and updates to the email fallback', () => {
    vi.mocked(useUser).mockReturnValue({ user: { fullName: ' Revanth ', primaryEmailAddress: { emailAddress: 'revanth@example.test' } } } as ReturnType<typeof useUser>)
    const { result, rerender } = renderHook(useDisplayName, { wrapper: ({ children }: { children: ReactNode }) => <DisplayNameBridge clerkConfigured>{children}</DisplayNameBridge> })
    expect(result.current).toBe('Revanth')
    vi.mocked(useUser).mockReturnValue({ user: { fullName: null, primaryEmailAddress: { emailAddress: 'revanth@example.test' } } } as ReturnType<typeof useUser>)
    rerender()
    expect(result.current).toBe('revanth')
  })
})
