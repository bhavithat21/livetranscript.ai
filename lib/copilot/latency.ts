'use client'
import posthog from 'posthog-js'
import { parseDraftStream } from './draftProtocol'

// Emit one copilot answer's timing to PostHog as an explicit `copilot_latency`
// event. Fail-safe by design: never throws (posthog may be unloaded or keyless),
// so instrumentation can't break the answer path.
//   ttft_ms  = request start → FIRST token (the number that matters for a copilot)
//   total_ms = request start → stream complete
//   phase    = draft / refined / final, derived from the raw stream (parseDraftStream)
//              so we can tell a two-pass drafted answer from a single-pass one.
export function captureLatency(
  mode: string,
  startedAt: number,
  firstTokenAt: number | null,
  rawAnswer: string,
): void {
  try {
    if (firstTokenAt === null) return // no token ever arrived — nothing meaningful to time
    posthog.capture('copilot_latency', {
      mode,
      ttft_ms: Math.round(firstTokenAt - startedAt),
      total_ms: Math.round(performance.now() - startedAt),
      phase: parseDraftStream(rawAnswer).phase,
    })
  } catch {
    /* analytics must never break the answer path */
  }
}
