import { describe, expect, it } from 'vitest'
import { filterPrivateAnalytics, isInterviewLocation } from '../analyticsPrivacy'
import type { CaptureResult } from 'posthog-js'

describe('interview analytics privacy', () => {
  it('recognizes the studio and its API without blocking unrelated paths', () => {
    for (const path of ['/interview', '/interview/review', '/api/interview', 'https://livetranscript.ai/interview']) expect(isInterviewLocation(path)).toBe(true)
    for (const path of ['/interviews-marketing', '/dashboard', null]) expect(isInterviewLocation(path)).toBe(false)
  })
  it('drops events containing an interview URL or referrer', () => {
    for (const key of ['$current_url', '$pathname', '$referrer', '$initial_current_url', '$initial_referrer']) {
      const event = { event: '$pageview', properties: { [key]: '/interview' } } as CaptureResult
      expect(filterPrivateAnalytics(event)).toBeNull()
    }
  })
})
