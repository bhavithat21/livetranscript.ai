import { vendorForModel } from './modes'

// Rough per-model pricing so usage events carry a COST estimate — turning
// "unlimited" into "unlimited AND I can see what it costs" when summed in PostHog.
// USD per 1M tokens {input, output}. Approximate + point-in-time (mid-2026); update
// as vendor prices move. Unknown models fall back to a mid-range default so cost is
// never silently zero. Groq/open models are cents; frontier Claude/GPT are dollars.
const PRICE_PER_1M: Record<string, { in: number; out: number }> = {
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 }, // Groq
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'gemini-flash-latest': { in: 0.3, out: 2.5 },
}
const DEFAULT_PRICE = { in: 1, out: 5 }

function priceFor(model: string): { in: number; out: number } {
  return PRICE_PER_1M[model] ?? DEFAULT_PRICE
}

// ~4 chars per token is the standard rough heuristic (good enough for cost trends,
// not billing). We only know INPUT size server-side at emit time (the answer streams,
// so output length isn't known without buffering — which we won't do on the hot
// path). So this estimates INPUT cost precisely-ish and OUTPUT cost from a typical
// answer length, flagged as an estimate. Sum `est_cost_usd` in PostHog for a spend view.
export function estimateCostUsd(model: string, inputChars: number, assumedOutputTokens = 500): number {
  const price = priceFor(model)
  const inputTokens = inputChars / 4
  return (inputTokens * price.in + assumedOutputTokens * price.out) / 1_000_000
}

// Convenience: the dimensions to attach to a usage event for cost analysis.
export function costDims(model: string, inputChars: number): Record<string, unknown> {
  return {
    vendor: vendorForModel(model),
    input_chars: inputChars,
    est_cost_usd: Number(estimateCostUsd(model, inputChars).toFixed(6)),
  }
}
