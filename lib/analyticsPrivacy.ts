import type { CaptureResult } from 'posthog-js'

export function isRemoteLocation(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const path = new URL(value, 'https://livetranscript.ai').pathname
    return path === '/remote' || path.startsWith('/remote/') || path.startsWith('/api/remote/')
  } catch { return false }
}

export function isInterviewLocation(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const path = new URL(value, 'https://livetranscript.ai').pathname
    return path === '/interview' || path.startsWith('/interview/') || path === '/api/interview' || path.startsWith('/api/interview/')
  } catch { return false }
}
const isPrivateLocation = (value: unknown) => isRemoteLocation(value) || isInterviewLocation(value)

/** Evaluated at capture time, including SPA navigation and SDK initialization. */
export function filterPrivateAnalytics(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null
  if (typeof window !== 'undefined' && isPrivateLocation(window.location.href)) return null
  const properties = event.properties
  if (['$current_url', '$pathname', '$referrer', '$initial_current_url', '$initial_referrer'].some((key) => isPrivateLocation(properties[key]))) return null
  // Screen frames, invites and typed input must never enter a session replay.
  if (event.event === '$snapshot') return null
  return event
}
