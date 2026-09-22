import { describe, expect, it } from 'vitest'
import type { CaptureResult } from 'posthog-js'
import { isPrivateWorkspaceLocation, filterPrivateAnalytics } from './analyticsPrivacy'
describe('private workspace analytics', () => {
  it.each(['/copilot?mode=repoInterview', '/practice', '/settings#profile', '/api/copilot/practice', '/interview', '/remote'])('excludes %s and later events referring to it', (path) => {
    expect(isPrivateWorkspaceLocation(path)).toBe(true)
    expect(filterPrivateAnalytics({ uuid: '00000000-0000-4000-8000-000000000001', event: '$pageview', properties: { $pathname: '/pricing', $referrer: `https://livetranscript.ai${path}` } } as CaptureResult)).toBeNull()
  })
  it('retains marketing page events', () => {
    const event = { uuid: '00000000-0000-4000-8000-000000000001', event: '$pageview', properties: { $pathname: '/pricing' } } as CaptureResult
    expect(filterPrivateAnalytics(event)).toBe(event)
  })
})
