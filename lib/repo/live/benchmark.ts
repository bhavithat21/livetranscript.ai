import { compileContext } from './context'
import { createSession, makeEvent, reduceSession } from './policy'
import { anchorEdit } from './engine'
import { requestGuidance } from './client'
import type { CodePlan, RepoSession } from './types'

const SPECS = [
  { id: 'transition', question: 'Fix the transition rule: only PROCESSING to SHIPPED is allowed. Preserve the public API.', parameters: 'current: string, next: string', before: "current === 'PROCESSING' || next === 'SHIPPED'", concepts: ['transition', 'condition'] },
  { id: 'expiry', question: 'An entry must be expired at or after its expiry time, including the exact boundary. Fix the bug without changing the API.', parameters: 'now: number, expires: number', before: 'now > expires', concepts: ['boundary', 'expir'] },
  { id: 'bounds', question: 'A valid zero-based index is nonnegative and strictly less than count. Fix the boundary bug.', parameters: 'index: number, count: number', before: 'index >= 0 && index <= count', concepts: ['bound', 'index'] },
] as const
export type BenchmarkInput = { id: string; state: RepoSession }
export function publicBenchmarkInputs(): BenchmarkInput[] {
  return SPECS.map(spec => {
    let state = createSession('public-benchmark-' + spec.id, 0)
    state = reduceSession(state, makeEvent(state, { kind: 'question', data: { id: spec.id, raw: spec.question } }, 1))
    state = reduceSession(state, makeEvent(state, { kind: 'observation', data: { origin: 'fixture', activePath: 'src/Rule.ts', observation: { files: [{ path: 'src/Rule.ts', language: 'typescript', startLine: 1, endOfFile: true, confidence: 1, lines: [`export function check(${spec.parameters}): boolean {`, `  return ${spec.before}`, '}'] }], visiblePaths: ['src/Rule.ts', 'test/Rule.test.ts'], terminal: '', requirements: [spec.question] } } }, 2))
    return { id: spec.id, state }
  })
}
export function evaluateContract(input: BenchmarkInput, say: string, plan: CodePlan | null): { checks: Record<string, boolean>; note: string } {
  const checks = {
    directOpening: !!say.trim() && !/^(?:great question|the transcript|based on the transcript|i cannot)/i.test(say.trim()),
    conciseSpeech: say.trim().split(/\s+/).length <= 100,
    structuredPlan: plan !== null,
    knownNavigation: !plan?.navigation || input.state.snapshot.visiblePaths.includes(plan.navigation.path),
    hasGroundedEdit: !!plan?.edits.length && plan.edits.every(e => anchorEdit(input.state.snapshot.files.find(f => f.path === e.path), e.before) !== null && e.after.trim().length > 0),
    avoidsInventedExecution: !/\b(?:i ran|i executed|all tests pass|tests are passing|i have applied|i fixed the code)\b/i.test(say + ' ' + (plan?.summary ?? '')),
  }
  return { checks, note: 'Mechanical contract checks, not a semantic correctness score or executed test result. Review each proposed patch. Golden tests are not supplied to the model.' }
}
export type BenchmarkRow = { id: string; status: 'complete' | 'failed'; speechModel?: string; codeModel?: string; firstTextMs?: number | null; elapsedMs: number; say?: string; plan?: CodePlan | null; evaluation?: ReturnType<typeof evaluateContract>; error?: string }
export async function runPublicBenchmark(signal: AbortSignal, onRow: (row: BenchmarkRow) => void, transport = requestGuidance): Promise<BenchmarkRow[]> {
  const rows: BenchmarkRow[] = []
  for (const input of publicBenchmarkInputs()) {
    signal.throwIfAborted()
    const started = performance.now()
    let row: BenchmarkRow
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 35000)
    const linked = AbortSignal.any([signal, controller.signal])
    try {
      // Same production endpoint and prompts; never send the rubric or reference patch.
      const [speech, code] = await Promise.all([
        transport('say', compileContext(input.state, 7000).text, input.state.question!.text, linked),
        transport('plan', compileContext(input.state).text, input.state.question!.text, linked),
      ])
      linked.throwIfAborted()
      row = { id: input.id, status: 'complete', speechModel: speech.model, codeModel: code.model, firstTextMs: speech.firstTokenMs, elapsedMs: Math.round(performance.now() - started), say: speech.text, plan: code.plan, evaluation: evaluateContract(input, speech.text, code.plan) }
    } catch {
      controller.abort()
      if (signal.aborted) throw new DOMException('Benchmark stopped', 'AbortError')
      row = { id: input.id, status: 'failed', elapsedMs: Math.round(performance.now() - started), error: 'Model request failed or exceeded its deadline. No automatic retry. Check configured provider credentials and supported model IDs.' }
    } finally { clearTimeout(deadline) }
    rows.push(row); onRow(row)
  }
  return rows
}
