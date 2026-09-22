import { describe, expect, it } from 'vitest'
import type { CaptureResult } from 'posthog-js'
import { filterPrivateAnalytics, isRemoteLocation } from '@/lib/analyticsPrivacy'

describe('interview analytics privacy', () => {
  it.each(['/interview', '/interview?mode=mock', '/interview/feedback', '/api/interview', 'https://livetranscript.ai/interview#feedback'])('excludes %s', (url) => { expect(isRemoteLocation(url)).toBe(true) })
  it('excludes interview referrers from later page events', () => {
    const event = { uuid: '00000000-0000-4000-8000-000000000001', event: '$pageview', properties: { $pathname: '/dashboard', $referrer: 'https://livetranscript.ai/interview' } } as CaptureResult
    expect(filterPrivateAnalytics(event)).toBeNull()
  })
  it('does not block unrelated marketing paths', () => { expect(isRemoteLocation('/pricing')).toBe(false) })
})
