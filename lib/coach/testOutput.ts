import type { TestEvidence } from './types'
type Parsed = Pick<TestEvidence, 'status' | 'passed' | 'failed'>

/** Observed output only, never proof that we ran a process. Counts from different
 * test runs are never added together. An incomplete NEW run invalidates an older
 * passing summary still visible above it in terminal scrollback.
 */
export function parseTestOutput(output: string): Parsed {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').replaceAll('\r', '').split('\n')
  let result: Parsed = { status: 'incomplete', passed: null, failed: null }
  let tap: { passed: number | null; failed: number | null } | null = null
  let pythonCount: number | null = null
  let failedSinceStart = false
  const number = (value: string) => Math.min(1_000_000, Number(value))
  const summary = (passed: number | null, failed: number | null): Parsed => {
    if ((failed ?? 0) > 0) failedSinceStart = true
    return { status: (failed ?? 0) > 0 ? 'observed-fail' : (passed ?? 0) > 0 && (failed ?? 0) === 0 ? 'observed-pass' : 'incomplete', passed, failed }
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (/^(?:Running tests|collecting\b|RUN\s+v\d|Test run for|TAP version|>\s+\S.*\btest\b|\[INFO\]\s+Running\s+)/i.test(line)) {
      result = { status: 'running', passed: null, failed: null }; tap = null; pythonCount = null; failedSinceStart = false
    }
    const tapPassed = line.match(/^# pass (\d+)$/), tapFailed = line.match(/^# fail (\d+)$/)
    if (tapPassed || tapFailed) {
      if (!tap || (tapPassed && tap.passed !== null)) tap = { passed: null, failed: null }
      if (tapPassed) tap.passed = number(tapPassed[1])
      if (tapFailed) tap.failed = number(tapFailed[1])
      result = tap.passed !== null && tap.failed !== null ? summary(tap.passed, tap.failed) : { status: 'incomplete', ...tap }
      continue
    }
    // dotnet test: 'Passed! - Failed: 0, Passed: 27, Skipped: 0, Total: 27'
    const dotnet = line.match(/^(?:Passed!|Failed!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+)/i)
    if (dotnet) { result = summary(number(dotnet[2]), number(dotnet[1])); continue }
    // Maven/Surefire summary may contain errors separately from failed assertions.
    const maven = line.match(/^(?:\[(?:INFO|ERROR)\]\s*)?Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i)
    if (maven) {
      const [total, failures, errors, skipped] = maven.slice(1).map(number)
      result = failures + errors + skipped <= total ? summary(total - failures - errors - skipped, failures + errors) : { status: 'incomplete', passed: null, failed: null }
      continue
    }
    const junit = line.match(/^OK\s*\((\d+) tests?\)$/)
    if (junit) { result = summary(number(junit[1]), 0); continue }
    const ran = line.match(/^Ran (\d+) tests? in /)
    if (ran) { pythonCount = number(ran[1]); result = { status: 'running', passed: null, failed: null }; continue }
    if (line === 'OK') { result = pythonCount === null ? { status: 'incomplete', passed: null, failed: null } : summary(pythonCount, 0); continue }
    const go = line.match(/^ok\s+\S+\s+(?:[\d.]+s|\(cached\))$/)
    if (go) { result = { status: 'observed-pass', passed: null, failed: null }; continue }
    // Jest/Vitest, pytest and Rust test-run summaries; plain '10 passed' is
    // deliberately not enough to conclude a test run has finished.
    if (/^(?:Tests:?\s+|=+|test result:\s+)/i.test(line) && /\b(?:passed|failed)\b/.test(line)) {
      const passed = line.match(/(\d+)\s+passed\b/), failed = line.match(/(\d+)\s+failed\b/)
      const errors = line.match(/(\d+)\s+errors?\b/)
      result = summary(passed ? number(passed[1]) : null, (failed ? number(failed[1]) : 0) + (errors ? number(errors[1]) : 0))
      continue
    }
    if (/^(?:FAIL(?:\s|$)|FAILURES!!!|FAILED(?:\s|\s*\()|error (?:TS|CS)\d+|Compilation failure|BUILD FAILED|\[ERROR\].*BUILD FAILURE)/i.test(line)) {
      failedSinceStart = true
      result = { ...result, status: 'observed-fail' }
    }
  }
  // A later passing package cannot erase an earlier failure in the same run.
  // Do not combine incompatible package counts into a made-up total.
  return failedSinceStart && result.status !== 'observed-fail'
    ? { status: 'observed-fail', passed: null, failed: null } : result
}
