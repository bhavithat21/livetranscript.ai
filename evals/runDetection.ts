// Question-detection precision/recall eval — a PURE-LOGIC gate, no model call.
//
// WHAT IT TRULY VERIFIES (real, not stubbed): it imports the REAL `latestQuestion`
// detector from lib/copilot/useProactive.ts (the exact regex the proactive
// auto-answer runs) and, for each labeled line, checks whether it FIRES (returns
// non-null). It computes precision/recall/F1 against the golden labels and prints a
// table + every misclassified line. This is the real detector on real inputs — the
// only thing "golden" is the human labels in golden/detection.json.
//
// WHY IT GATES CI: unlike runCoding/runBehavioralVoice this needs NO API key and
// hits NO network, so it runs on every CI pass. It fails only if F1 drops below
// F1_FLOOR — a genuine regression gate, not a flaky exact-match check (a couple of
// judgment-call lines can flip without failing the build).
//
// HOW TO RUN: `npm run eval:detection` (vitest with evals/vitest.eval.config.ts).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { latestQuestion } from '@/lib/copilot/useProactive'

type Labeled = { text: string; isQuestion: boolean }

const here = dirname(fileURLToPath(import.meta.url))
const golden: Labeled[] = JSON.parse(readFileSync(join(here, 'golden', 'detection.json'), 'utf8'))

// F1 must stay at or above this to pass — a real regression gate. The current
// detector clears the golden set comfortably; 0.8 leaves room for a couple of
// judgment-call lines to flip without a false CI failure.
const F1_FLOOR = 0.8

describe('question-detection precision/recall eval', () => {
  it(`scores the real latestQuestion detector on ${golden.length} labeled lines`, () => {
    // Confusion matrix + the lines the detector got wrong, for the report.
    let tp = 0
    let fp = 0
    let tn = 0
    let fn = 0
    const misses: { text: string; expected: boolean; got: boolean }[] = []

    for (const row of golden) {
      const fired = latestQuestion(row.text) !== null
      if (fired && row.isQuestion) tp++
      else if (fired && !row.isQuestion) fp++
      else if (!fired && !row.isQuestion) tn++
      else fn++
      if (fired !== row.isQuestion) misses.push({ text: row.text, expected: row.isQuestion, got: fired })
    }

    const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

    // Report: confusion matrix, the three metrics, and every misclassified line.
    const pct = (n: number) => (n * 100).toFixed(1) + '%'
    const lines = [
      '',
      'Question-detection eval — real latestQuestion() detector',
      `lines: ${golden.length}   positives: ${tp + fn}   negatives: ${fp + tn}`,
      `TP ${tp}  FP ${fp}  TN ${tn}  FN ${fn}`,
      '-'.repeat(52),
      `precision: ${pct(precision)}   recall: ${pct(recall)}   F1: ${f1.toFixed(3)}`,
      '-'.repeat(52),
      misses.length ? 'misclassified:' : 'misclassified: none',
      ...misses.map((m) => `  [expected ${m.expected ? 'Q' : '·'} got ${m.got ? 'Q' : '·'}] ${m.text}`),
      '',
    ]
    // eslint-disable-next-line no-console -- eval report is the whole point of this runner
    console.log(lines.join('\n'))

    expect(f1).toBeGreaterThanOrEqual(F1_FLOOR)
  })
})
