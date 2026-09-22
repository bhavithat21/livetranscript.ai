import { afterEach, describe, expect, it } from 'vitest'
import type { CaptureResult } from 'posthog-js'
import { filterPrivateAnalytics } from './analyticsPrivacy'

afterEach(() => window.history.replaceState(null, '', '/'))

describe('remote analytics privacy', () => {
  const event = (properties: Record<string, unknown> = {}, name = '$pageview') => ({ event: name, properties } as CaptureResult)
  it('drops events before any invite fragment is consumed', () => {
    window.history.replaceState(null, '', '/remote#invite=secret')
    expect(filterPrivateAnalytics(event({ arbitrary: 'typed text' }))).toBeNull()
  })
  it('also blocks queued events, referrers and all replay snapshots after navigation', () => {
    expect(filterPrivateAnalytics(event({ $current_url: 'https://livetranscript.ai/remote#invite=secret' }))).toBeNull()
    expect(filterPrivateAnalytics(event({ $referrer: 'https://livetranscript.ai/remote' }))).toBeNull()
    expect(filterPrivateAnalytics(event({}, '$snapshot'))).toBeNull()
    const publicEvent = event({ $current_url: 'https://livetranscript.ai/pricing' })
    expect(filterPrivateAnalytics(publicEvent)).toBe(publicEvent)
  })
})
