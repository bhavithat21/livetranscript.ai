// Coding pass@1 eval harness.
//
// WHAT IT TRULY VERIFIES (real, not stubbed):
//   For each golden problem it generates a solution through the REAL model path
//   (lib/copilot/providers.streamAnswer with the REAL coding mode prompt +
//   model/key selection, same as app/api/copilot/answer/route.ts), strips any
//   speculative-draft sentinels with the REAL parseDraftStream, extracts code +
//   tests with the REAL extractCode/extractTests, then EXECUTES the generated JS
//   solution against (a) the model's OWN generated tests and (b) the golden tests.
//   pass@1 for a problem = code was produced AND every golden test passes AND
//   (its own generated tests, if any, all pass). This is genuine execution-based
//   pass@1 — the solution really runs.
//
// WHAT IT DOES NOT DO: it runs JS/TS golden problems only. The production executor
// (jsRunner Web Worker + Pyodide via /pyodide-worker.js) is BROWSER-ONLY and can't
// run under Node/vitest, so Python problems can't be executed here — the golden set
// is JavaScript and evals/jsNodeRunner.ts mirrors jsRunner's exact check() contract
// in node:vm. Add Python coverage via a Playwright/browser harness if needed.
//
// HOW TO RUN: `npm run eval:coding` (vitest with evals/vitest.eval.config.ts).
// It reads keys from process.env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GROQ_API_KEY)
// exactly as the route does; with NO usable key it SKIPS (never hard-fails CI).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it } from 'vitest'
import { modeProfile, modelForTier, vendorForModel, fastFallbackModel, thinkingConfigFor } from '@/lib/copilot/modes'
import { streamAnswer } from '@/lib/copilot/providers'
import { extractCode, extractTests } from '@/lib/copilot/codeExecutor'
import { parseDraftStream } from '@/lib/copilot/draftProtocol'
import { runJsTestsNode } from './jsNodeRunner'

type GoldenProblem = { id: string; language: string; prompt: string; tests: string }

const here = dirname(fileURLToPath(import.meta.url))
const golden: GoldenProblem[] = JSON.parse(readFileSync(join(here, 'golden', 'coding.json'), 'utf8'))

// Same key gate as app/api/copilot/answer/route.ts — decide the model, then check
// the owning vendor's key is present.
function keyFor(model: string): boolean {
  switch (vendorForModel(model)) {
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY
    case 'groq': return !!process.env.GROQ_API_KEY
    case 'openai': return !!process.env.OPENAI_API_KEY
    default: return true
  }
}

const profile = modeProfile('coding')
let CODING_MODEL = modelForTier(profile.tier)
if (!keyFor(CODING_MODEL)) CODING_MODEL = fastFallbackModel()
const HAS_KEY = keyFor(CODING_MODEL)

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

// Generate one coding answer the same way the answer route does, returning the
// final (draft-stripped) markdown.
async function generate(prompt: string): Promise<string> {
  const posture = thinkingConfigFor('coding', CODING_MODEL)
  const raw = await drain(
    streamAnswer({
      model: CODING_MODEL,
      system: profile.system,
      transcript: '',
      context: null,
      history: [],
      question: prompt,
      image: null,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      thinking: posture.thinking,
      effort: posture.effort,
    }),
  )
  return parseDraftStream(raw).text
}

type Row = { id: string; goldenPassed: number; goldenTotal: number; ownPassed: number; ownTotal: number; pass1: boolean; note: string }

describe('coding pass@1 eval', () => {
  it.skipIf(!HAS_KEY)(
    `generates + executes ${golden.length} golden problems (model: ${CODING_MODEL})`,
    async () => {
      const rows: Row[] = []

      for (const problem of golden) {
        const answer = await generate(problem.prompt).catch((e) => `__ERROR__ ${e instanceof Error ? e.message : String(e)}`)
        const extracted = extractCode(answer)
        const ownTests = extractTests(answer)

        // No code / non-JS solution → can't execute → pass@1 fails with a clear note.
        if (!extracted) {
          rows.push({ id: problem.id, goldenPassed: 0, goldenTotal: 0, ownPassed: 0, ownTotal: 0, pass1: false, note: 'no code block extracted' })
          continue
        }
        if (extracted.language !== 'javascript' && extracted.language !== 'typescript') {
          rows.push({ id: problem.id, goldenPassed: 0, goldenTotal: 0, ownPassed: 0, ownTotal: 0, pass1: false, note: `non-executable language: ${extracted.language}` })
          continue
        }

        const goldenRun = runJsTestsNode(extracted.code, problem.tests)
        const ownRun = ownTests ? runJsTestsNode(extracted.code, ownTests.tests) : { passed: 0, failed: 0, total: 0, cases: [] }

        const allGolden = goldenRun.total > 0 && goldenRun.failed === 0
        const allOwn = ownRun.total === 0 ? true : ownRun.failed === 0
        const pass1 = allGolden && allOwn

        rows.push({
          id: problem.id,
          goldenPassed: goldenRun.passed,
          goldenTotal: goldenRun.total,
          ownPassed: ownRun.passed,
          ownTotal: ownRun.total,
          pass1,
          note: ownRun.total === 0 ? 'model produced no tests' : '',
        })
      }

      // Report: problem | golden passed/total | own passed/total | pass@1.
      const pad = (s: string, n: number) => s.padEnd(n)
      const lines = [
        '',
        `Coding pass@1 eval — model: ${CODING_MODEL}`,
        pad('problem', 22) + pad('golden', 12) + pad('own', 12) + 'pass@1',
        '-'.repeat(52),
        ...rows.map(
          (r) =>
            pad(r.id, 22) +
            pad(`${r.goldenPassed}/${r.goldenTotal}`, 12) +
            pad(`${r.ownPassed}/${r.ownTotal}`, 12) +
            (r.pass1 ? 'PASS' : 'FAIL') +
            (r.note ? `  (${r.note})` : ''),
        ),
        '-'.repeat(52),
      ]
      const passed = rows.filter((r) => r.pass1).length
      const rate = rows.length ? ((passed / rows.length) * 100).toFixed(1) : '0.0'
      lines.push(`overall pass@1: ${passed}/${rows.length} = ${rate}%`, '')
      // eslint-disable-next-line no-console -- eval report is the whole point of this runner
      console.log(lines.join('\n'))
    },
    300_000,
  )
})
