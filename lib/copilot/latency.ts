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
// Rolling in-session TTFT samples (this tab only) so the UI can show a LIVE p50/p95
// readout while testing — "fast" becomes measured on the spot, not just asserted in
// PostHog after the fact. Bounded so it can't grow unbounded over a long session.
const MAX_SAMPLES = 200
const ttftSamples: number[] = []

export function captureLatency(
  mode: string,
  startedAt: number,
  firstTokenAt: number | null,
  rawAnswer: string,
): void {
  try {
    if (firstTokenAt === null) return // no token ever arrived — nothing meaningful to time
    const ttft = Math.round(firstTokenAt - startedAt)
    ttftSamples.push(ttft)
    if (ttftSamples.length > MAX_SAMPLES) ttftSamples.shift()
    posthog.capture('copilot_latency', {
      mode,
      ttft_ms: ttft,
      total_ms: Math.round(performance.now() - startedAt),
      phase: parseDraftStream(rawAnswer).phase,
    })
  } catch {
    /* analytics must never break the answer path */
  }
}

// p50 / p95 time-to-first-token over this session's samples, for the live readout.
// Returns null until there's at least one sample.
export function latencyStats(): { count: number; p50: number; p95: number } | null {
  if (!ttftSamples.length) return null
  const sorted = [...ttftSamples].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
  return { count: sorted.length, p50: at(50), p95: at(95) }
}
