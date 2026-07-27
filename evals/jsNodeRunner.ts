// Node-side JS test executor for the coding eval. The production executor
// (lib/copilot/jsRunner.ts) runs solutions in a browser Web Worker, which doesn't
// exist under Node/vitest — so this mirrors its EXACT contract (the `check()`
// signature + the per-line try/catch harness) using node:vm instead. Same wire:
// tests are `check(actual, expected, 'label')` lines; each runs isolated so one
// failure doesn't abort the rest.
//
// ponytail: deliberate duplication of jsRunner's harness (it's not exported, and
// production must not change for an eval). If jsRunner's check()/harness ever
// changes, update this to match — one small mirror, upgrade path is "export the
// harness builder from jsRunner and share it".
import vm from 'node:vm'

export type JsTestCase = { label: string; passed: boolean; error?: string }
export type JsTestRunResult = { passed: number; failed: number; total: number; cases: JsTestCase[] }

const DEFAULT_TIMEOUT = 8_000

// Build + run solution followed by the check()-based tests, one try/catch per line
// so every case reports independently. Identical labelling + escaping to jsRunner.
export function runJsTestsNode(solution: string, tests: string, timeoutMs = DEFAULT_TIMEOUT): JsTestRunResult {
  const lines = tests
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'))

  if (!lines.length) {
    return { passed: 0, failed: 1, total: 1, cases: [{ label: 'no tests', passed: false, error: 'no test lines' }] }
  }

  const labels = lines.map((line, i) => {
    const comment = line.match(/\/\/\s*(.+)$/)?.[1] ?? `test ${i + 1}`
    return comment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  })

  const harness = lines
    .map((line, i) => {
      const cleanLine = line.replace(/\/\/.*$/, '').trim().replace(/;$/, '')
      return [
        `try {`,
        `  ${cleanLine};`,
        `  __results__.push(['${labels[i]}', true, null]);`,
        `} catch(e) {`,
        `  __results__.push(['${labels[i]}', false, e.message || String(e)]);`,
        `}`,
      ].join('\n')
    })
    .join('\n')

  // Wrap in an IIFE so a solution written as top-level statements (and any
  // `return` the harness relies on) behaves exactly as jsRunner's `new Function`.
  const code = [
    '(function(){',
    solution,
    '',
    'function check(actual, expected, label) {',
    '  if (JSON.stringify(actual) !== JSON.stringify(expected))',
    '    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));',
    '}',
    '',
    'var __results__ = [];',
    harness,
    'return JSON.stringify(__results__);',
    '})()',
  ].join('\n')

  try {
    const raw = vm.runInNewContext(code, Object.create(null), { timeout: timeoutMs }) as string
    const parsed = JSON.parse(raw) as Array<[string, boolean, string | null]>
    const cases: JsTestCase[] = []
    let passed = 0
    let failed = 0
    for (const [label, ok, err] of parsed) {
      cases.push({ label, passed: ok, error: err ?? undefined })
      if (ok) passed++
      else failed++
    }
    return { passed, failed, total: cases.length, cases }
  } catch (e) {
    // Compile error / infinite-loop timeout / thrown-before-harness — fail every case.
    const error = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 4).join('\n')
    return { passed: 0, failed: labels.length, total: labels.length, cases: labels.map((label) => ({ label, passed: false, error })) }
  }
}
