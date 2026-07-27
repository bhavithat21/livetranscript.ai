'use client'
import type { TestRunResult, TestCase } from './pyodideRunner'

// Client side of remote execution for compiled / non-browser languages. Posts a
// self-contained program to /api/execute (which proxies to Judge0), and parses its
// stdout into the SAME TestRunResult shape the in-browser Python/JS runners return,
// so the orchestrator + UI treat every language identically.
//
// Test convention for these languages: the model emits ONE runnable program whose
// main() runs each case and prints a line `PASS <label>` or `FAIL <label> :: <detail>`
// per case (the CODING prompt instructs this for remote-executed languages). We
// combine the solution + the test-harness program and parse those lines. A compile
// error or a crash before any line = a single failed "compile/run" case with the
// executor's message, so the user sees WHY instead of a silent zero.

// Languages that run remotely (must match app/api/execute JUDGE0_LANG keys).
const REMOTE_LANGS = new Set(['java', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'swift', 'kotlin', 'scala'])

export function canExecuteRemote(language: string): boolean {
  return REMOTE_LANGS.has(language)
}

// Parse `PASS label` / `FAIL label :: detail` lines out of stdout.
function parseResultLines(stdout: string): TestCase[] {
  const cases: TestCase[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    const pass = t.match(/^PASS\s+(.+)$/)
    const fail = t.match(/^FAIL\s+(.+?)(?:\s*::\s*(.*))?$/)
    if (pass) cases.push({ label: pass[1].trim(), passed: true })
    else if (fail) cases.push({ label: fail[1].trim(), passed: false, error: fail[2]?.trim() || undefined })
  }
  return cases
}

// Run a compiled-language solution+tests remotely. `program` is the full source to
// execute (solution + test harness already combined by the caller). Returns the
// unified TestRunResult; a compile error or a run that printed no PASS/FAIL lines
// becomes one explanatory failed case.
export async function runRemoteTests(program: string, language: string, timeoutMs = 20_000): Promise<TestRunResult> {
  try {
    const res = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, source: program }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ error: 'Executor unavailable' }))
      return failAll(msg.error || 'Executor unavailable')
    }
    const data = (await res.json()) as {
      stdout: string
      stderr: string
      compileOutput: string
      status: string
      ok: boolean
    }
    if (data.compileOutput) return failAll(`Compile error: ${firstLines(data.compileOutput)}`)
    const cases = parseResultLines(data.stdout || '')
    if (!cases.length) {
      // Ran but printed no PASS/FAIL — surface stderr/status so it's not a silent zero.
      const detail = data.stderr ? firstLines(data.stderr) : data.status || 'no test output'
      return failAll(`No test results — ${detail}`)
    }
    // Crash guard: the harness may print a few PASS lines and THEN crash mid-run
    // (non-zero exit). Without this, those partial PASSes would read as all-green.
    // A non-Accepted status means the run didn't finish cleanly — append an explicit
    // failed case so a crash can never masquerade as success.
    if (!data.ok) {
      cases.push({
        label: 'run did not complete',
        passed: false,
        error: data.stderr ? firstLines(data.stderr) : data.status || 'non-zero exit',
      })
    }
    const passed = cases.filter((c) => c.passed).length
    return { passed, failed: cases.length - passed, total: cases.length, cases }
  } catch (e) {
    return failAll(e instanceof Error && e.name === 'TimeoutError' ? 'Execution timed out' : 'Execution failed')
  }
}

function firstLines(s: string, n = 3): string {
  return s.split('\n').slice(0, n).join(' ').slice(0, 300)
}

function failAll(error: string): TestRunResult {
  return { passed: 0, failed: 1, total: 1, cases: [{ label: 'compile / run', passed: false, error }] }
}
