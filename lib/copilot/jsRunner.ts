'use client'

export type JsRunResult = { ok: boolean; output: string; error?: string }

const DEFAULT_TIMEOUT = 8_000

const WORKER_SCRIPT = `
self.onmessage = function(e) {
  var output = [];
  var _log = console.log;
  console.log = function() { output.push(Array.from(arguments).join(' ')); };
  try {
    var result = new Function(e.data.code)();
    if (result !== undefined && typeof result !== 'function')
      output.push(String(result));
    self.postMessage({ ok: true, output: output.join('\\n') });
  } catch(err) {
    self.postMessage({
      ok: false,
      output: output.join('\\n'),
      error: (err.stack || err.message || String(err)).split('\\n').slice(0, 4).join('\\n')
    });
  }
};
`

export async function runJavaScript(
  code: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<JsRunResult> {
  const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)

  return new Promise((resolve) => {
    const worker = new Worker(url)

    const timer = setTimeout(() => {
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({ ok: false, output: '', error: `Timed out after ${timeoutMs / 1000}s` })
    }, timeoutMs)

    worker.onmessage = (e) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(e.data as JsRunResult)
    }

    worker.onerror = (e) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({ ok: false, output: '', error: e.message || 'Worker error' })
    }

    worker.postMessage({ code })
  })
}

export type JsTestCase = { label: string; passed: boolean; error?: string }
export type JsTestRunResult = {
  passed: number
  failed: number
  total: number
  cases: JsTestCase[]
}

export async function runJsTests(
  solution: string,
  tests: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<JsTestRunResult> {
  const lines = tests
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'))

  if (!lines.length) {
    const result = await runJavaScript(solution + '\n' + tests, timeoutMs)
    return {
      passed: result.ok ? 1 : 0,
      failed: result.ok ? 0 : 1,
      total: 1,
      cases: [{ label: 'all tests', passed: result.ok, error: result.error }],
    }
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

  const code = [
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
  ].join('\n')

  const result = await runJavaScript(code, timeoutMs)

  if (!result.ok || !result.output) {
    return failAllJs(labels, result.error || 'Execution failed')
  }

  try {
    const parsed = JSON.parse(result.output) as Array<[string, boolean, string | null]>
    const cases: JsTestCase[] = []
    let passed = 0
    let failed = 0
    for (const [label, ok, err] of parsed) {
      cases.push({ label, passed: ok, error: err ?? undefined })
      if (ok) passed++
      else failed++
    }
    return { passed, failed, total: cases.length, cases }
  } catch {
    return failAllJs(labels, result.output || 'Failed to parse results')
  }
}

function failAllJs(labels: string[], error: string): JsTestRunResult {
  return {
    passed: 0,
    failed: labels.length,
    total: labels.length,
    cases: labels.map((label) => ({ label, passed: false, error })),
  }
}
