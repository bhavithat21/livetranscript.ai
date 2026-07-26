'use client'
// Execution-verified coding: run a Python solution IN THE BROWSER (Pyodide/WASM)
// so a coding answer is proven, not just plausible — the core "beats Cluely" edge.
// Zero API key, zero server cost, no bundle bloat: Pyodide (~6MB) loads lazily
// from the CDN the first time the user runs code, then is cached.
//
// Security: WASM runs sandboxed in the page — no filesystem, no host network.
// We still cap wall-clock time so an accidental infinite loop can't hang the tab.

const PYODIDE_VERSION = '0.26.4'
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

type Pyodide = {
  runPythonAsync: (code: string) => Promise<unknown>
  setStdout: (opts: { batched: (s: string) => void }) => void
  setStderr: (opts: { batched: (s: string) => void }) => void
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<Pyodide>
  }
}

let pyodidePromise: Promise<Pyodide> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load the Python sandbox'))
    document.head.appendChild(s)
  })
}

// Load once, cache the instance. Concurrent callers share the same promise.
function getPyodide(): Promise<Pyodide> {
  if (pyodidePromise) return pyodidePromise
  pyodidePromise = (async () => {
    await injectScript(`${CDN}pyodide.js`)
    if (!window.loadPyodide) throw new Error('Python sandbox unavailable')
    return window.loadPyodide({ indexURL: CDN })
  })()
  // If loading fails, allow a later retry.
  pyodidePromise.catch(() => {
    pyodidePromise = null
  })
  return pyodidePromise
}

// Trigger Pyodide download early (coding mode selected) so the first test run
// doesn't stall on the ~6MB WASM fetch. No-op if already loaded.
export function preloadPyodide(): void {
  if (typeof window === 'undefined') return
  getPyodide().catch(() => {})
}

export type RunResult = { ok: boolean; output: string; error?: string }

const DEFAULT_TIMEOUT = 8_000

// Run Python, capturing stdout/stderr. Resolves {ok:false, error} on exception or
// timeout — never throws, so the UI just shows the failure.
export async function runPython(code: string, timeoutMs = DEFAULT_TIMEOUT): Promise<RunResult> {
  let py: Pyodide
  try {
    py = await getPyodide()
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : 'Sandbox load failed' }
  }

  let out = ''
  py.setStdout({ batched: (s) => (out += s) })
  py.setStderr({ batched: (s) => (out += s) })

  const timeout = new Promise<RunResult>((resolve) =>
    setTimeout(() => resolve({ ok: false, output: out, error: `Timed out after ${timeoutMs / 1000}s` }), timeoutMs),
  )
  const exec = py
    .runPythonAsync(code)
    .then<RunResult>(() => ({ ok: true, output: out.trim() }))
    .catch<RunResult>((e: unknown) => ({
      ok: false,
      output: out.trim(),
      error: (e instanceof Error ? e.message : String(e)).split('\n').slice(-4).join('\n'),
    }))

  return Promise.race([exec, timeout])
}

// Pull the first Python fenced block out of a markdown answer, for the Run button.
export function extractPython(markdown: string): string | null {
  const m = markdown.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
  return m ? m[1].trim() : null
}

// Pull the ```python:tests fenced block (assert-based test cases for the solution).
export function extractTests(markdown: string): string | null {
  const m = markdown.match(/```python:tests\s*\n([\s\S]*?)```/i)
  return m ? m[1].trim() : null
}

export type TestCase = { label: string; passed: boolean; error?: string }
export type TestRunResult = { passed: number; failed: number; total: number; cases: TestCase[] }

// Run the solution + test-case asserts in Pyodide, reporting per-case pass/fail.
// Wraps each assert in a try/except so one failure doesn't abort the rest.
export async function runTests(
  solution: string,
  tests: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<TestRunResult> {
  const lines = tests
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('assert '))

  if (!lines.length) {
    const result = await runPython(solution + '\n' + tests, timeoutMs)
    return {
      passed: result.ok ? 1 : 0,
      failed: result.ok ? 0 : 1,
      total: 1,
      cases: [{ label: 'all tests', passed: result.ok, error: result.error }],
    }
  }

  const labels = lines.map((line, i) => {
    const comment = line.match(/#\s*(.+)$/)?.[1] ?? `test ${i + 1}`
    return comment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  })

  const harness = lines.map((line, i) => [
    `try:`,
    `    ${line}`,
    `    __results__.append(('${labels[i]}', True, None))`,
    `except AssertionError as e:`,
    `    __results__.append(('${labels[i]}', False, str(e) or 'assertion failed'))`,
    `except Exception as e:`,
    `    __results__.append(('${labels[i]}', False, f'{type(e).__name__}: {e}'))`,
  ].join('\n')).join('\n')

  const code = [
    solution,
    '__results__ = []',
    harness,
    // Serialize results to JSON so we get clean JS-side parsing instead of
    // relying on Pyodide proxy iteration (which varies across versions).
    'import json as __json__',
    '__json__.dumps(__results__)',
  ].join('\n')

  let py: Pyodide
  try {
    py = await getPyodide()
  } catch (e) {
    return failAll(labels, e instanceof Error ? e.message : 'Sandbox load failed')
  }

  let out = ''
  py.setStdout({ batched: (s) => (out += s) })
  py.setStderr({ batched: (s) => (out += s) })

  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs),
  )

  try {
    const raw = await Promise.race([py.runPythonAsync(code), timeout])
    if (raw === 'timeout') return failAll(labels, `Timed out after ${timeoutMs / 1000}s`)

    const parsed = JSON.parse(String(raw)) as Array<[string, boolean, string | null]>
    const cases: TestCase[] = []
    let passed = 0
    let failed = 0
    for (const [label, ok, err] of parsed) {
      cases.push({ label, passed: ok, error: err ?? undefined })
      if (ok) passed++
      else failed++
    }
    return { passed, failed, total: cases.length, cases }
  } catch (e) {
    const errMsg = (e instanceof Error ? e.message : String(e)).split('\n').slice(-4).join('\n')
    return failAll(labels, errMsg)
  }
}

function failAll(labels: string[], error: string): TestRunResult {
  return {
    passed: 0,
    failed: labels.length,
    total: labels.length,
    cases: labels.map((label) => ({ label, passed: false, error })),
  }
}
