'use client'
// Execution-verified coding: run a Python solution IN A WEB WORKER (Pyodide/WASM)
// so a coding answer is proven, not just plausible — the core "beats Cluely" edge.
// Zero API key, zero server cost, no bundle bloat: Pyodide (~6MB) loads lazily
// from the CDN the first time the user runs code, then is cached.
//
// Security / robustness: Python runs in a Worker, not the page. A worker global
// scope has no DOM — no document, cookies, or localStorage — so executed Python
// (e.g. `import js`) can't read the user's session. And because it's off the main
// thread, a CPU-bound loop (`while True: pass`) can't freeze the tab: the
// wall-clock timeout really fires by terminating the worker. Network is NOT
// blocked at this layer (a worker still has fetch); that's handled by CSP.

const DEFAULT_TIMEOUT = 8_000

type RawResult = { ok: boolean; output: string; raw: string | null; error?: string }
type WorkerHandle = { worker: Worker; ready: Promise<void> }

let handle: WorkerHandle | null = null
let runId = 0
// Serialize runs: one shared worker captures stdout in a global, so overlapping
// runs would interleave output. The app runs one solution at a time anyway.
let runQueue: Promise<unknown> = Promise.resolve()

function createWorker(): WorkerHandle {
  const worker = new Worker('/pyodide-worker.js')
  const ready = new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'loaded') {
        worker.removeEventListener('message', onMsg)
        resolve()
      } else if (d?.type === 'loadError') {
        worker.removeEventListener('message', onMsg)
        reject(new Error(d.error || 'Python sandbox unavailable'))
      }
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', () => reject(new Error('Failed to load the Python sandbox')), { once: true })
  })
  worker.postMessage({ type: 'load' })
  return { worker, ready }
}

// Load once, cache the worker. Concurrent callers share it. On load failure the
// handle is cleared so a later call can retry.
function getWorker(): WorkerHandle {
  if (handle) return handle
  handle = createWorker()
  handle.ready.catch(() => {
    handle = null
  })
  return handle
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = runQueue.then(task, task)
  runQueue = run.then(
    () => {},
    () => {},
  )
  return run
}

// Run one snippet in the worker with a real wall-clock timeout. On timeout the
// worker is terminated (killing any runaway loop) and dropped so the next call
// rebuilds it. Never throws — resolves {ok:false, error} instead.
function execInWorker(code: string, timeoutMs: number): Promise<RawResult> {
  const h = getWorker()
  return h.ready.then(
    () =>
      new Promise<RawResult>((resolve) => {
        const id = ++runId
        const timer = setTimeout(() => {
          h.worker.removeEventListener('message', onMsg)
          h.worker.terminate()
          if (handle === h) handle = null
          resolve({ ok: false, output: '', raw: null, error: `Timed out after ${timeoutMs / 1000}s` })
        }, timeoutMs)
        const onMsg = (e: MessageEvent) => {
          const d = e.data
          if (d?.type !== 'result' || d.id !== id) return
          clearTimeout(timer)
          h.worker.removeEventListener('message', onMsg)
          resolve({ ok: d.ok, output: d.output || '', raw: d.raw ?? null, error: d.error })
        }
        h.worker.addEventListener('message', onMsg)
        h.worker.postMessage({ type: 'run', id, code })
      }),
    (e: unknown) => ({ ok: false, output: '', raw: null, error: e instanceof Error ? e.message : 'Sandbox load failed' }),
  )
}

// Trigger Pyodide download early (coding mode selected) so the first test run
// doesn't stall on the ~6MB WASM fetch. No-op if already loaded.
export function preloadPyodide(): void {
  if (typeof window === 'undefined') return
  getWorker().ready.catch(() => {})
}

export type RunResult = { ok: boolean; output: string; error?: string }

// Run Python, capturing stdout/stderr. Resolves {ok:false, error} on exception or
// timeout — never throws, so the UI just shows the failure.
export async function runPython(code: string, timeoutMs = DEFAULT_TIMEOUT): Promise<RunResult> {
  const r = await enqueue(() => execInWorker(code, timeoutMs))
  if (r.ok) return { ok: true, output: r.output.trim() }
  return {
    ok: false,
    output: r.output.trim(),
    error: (r.error ?? 'Error').split('\n').slice(-4).join('\n'),
  }
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

  const r = await enqueue(() => execInWorker(code, timeoutMs))
  if (!r.ok) {
    return failAll(labels, (r.error ?? 'Sandbox load failed').split('\n').slice(-4).join('\n'))
  }

  try {
    const parsed = JSON.parse(String(r.raw)) as Array<[string, boolean, string | null]>
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
