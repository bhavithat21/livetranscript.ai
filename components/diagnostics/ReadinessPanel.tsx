'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { diagnosticSpan, getDiagnostics, getServerDiagnostics, subscribeDiagnostics } from '@/lib/diagnostics/client'
import { mockReadiness } from '@/lib/reliability/readiness'
import { testAsrRecovery } from '@/lib/reliability/mockControls'
import type { PreflightReport } from '@/lib/reliability/preflight'

export function ReadinessPanel() {
  const diagnostics = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getServerDiagnostics)
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [since, setSince] = useState<number | null>(null), [mock, setMock] = useState(false)
  const [checkSession, setCheckSession] = useState(''), [observed, setObserved] = useState<string[]>([])
  const [reviewed, setReviewed] = useState(false), [stopVerified, setStopVerified] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { const active = request.current; request.current = null; active?.abort() }, [])
  // Latch observed milestones, not raw content, while this checklist is active.
  // A 45-minute mock must not lose its startup evidence when the ring buffer rolls.
  useEffect(() => {
    if (since === null) return
    return subscribeDiagnostics(() => {
      const current = getDiagnostics()
      if (!current.enabled || current.sessionId !== checkSession) { setObserved(previous => previous.length ? [] : previous); return }
      const passed = mockReadiness(current.events, since).checks.filter(check => check.passed).map(check => check.label)
      setObserved(previous => passed.every(label => previous.includes(label)) ? previous : [...new Set([...previous, ...passed])])
    })
  }, [since, checkSession])
  const validChecklist = diagnostics.enabled && diagnostics.sessionId === checkSession
  const checks = since === null ? null : mockReadiness(diagnostics.events, since).checks.map(check => ({ ...check, passed: validChecklist && (check.passed || observed.includes(check.label)) }))
  async function checkModels() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    const trace = diagnosticSpan('app'); setBusy(true); setError(''); setReport(null)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 55_000)
    try {
      const response = await fetch('/api/diagnostics/preflight', { method: 'POST', headers: trace.headers(), signal: controller.signal })
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to check providers.' : response.status === 429 ? 'Wait one minute before checking again.' : 'Provider checks could not complete.')
      const data = await response.json() as PreflightReport
      if (data.version !== 1 || data.scope !== 'synthetic-server-probes' || data.deviceVerified !== false || typeof data.passed !== 'boolean' || !Array.isArray(data.checks) || !data.checks.length || data.checks.some(check => !check || !['passed', 'failed', 'disabled'].includes(check.status))) throw new Error('Invalid readiness report')
      if (data.passed !== data.checks.every(check => check.status !== 'failed')) throw new Error('Inconsistent readiness report')
      if (!controller.signal.aborted && request.current === controller) { setReport(data); trace.end(data.passed ? 'success' : 'error') }
    } catch (cause) {
      if (request.current === controller && (!controller.signal.aborted || timedOut)) {
        setError(timedOut ? 'Provider checks timed out. No successful readiness result was recorded.' : cause instanceof Error ? cause.message : 'Checks failed')
        trace.end('error', { code: timedOut ? 'timeout' : 'unavailable' })
      } else trace.end('cancelled')
    } finally { clearTimeout(timeout); if (request.current === controller) { setBusy(false); request.current = null } }
  }
  return <section aria-label="Readiness and recovery checks">
    <h3>Readiness and recovery checks</h3>
    <p>Run before a session. Provider checks make small, billable synthetic requests. They do not access your microphone or screen, and are not a full interview certification.</p>
    <button type="button" disabled={busy} onClick={() => void checkModels()}>{busy ? 'Checking actual provider access…' : 'Check model and transcription access'}</button>
    {error && <p role="alert">{error}</p>}
    {report && <><p role="status">{report.passed ? 'Synthetic server checks passed. Device checks are still required.' : 'Some configured services failed. Do not rely on this setup yet.'}</p><table><thead><tr><th>Check</th><th>Result</th><th>Time</th></tr></thead><tbody>{report.checks.map(check => <tr key={check.role}><td>{check.role}{check.model ? ` · ${check.model}` : ''}</td><td>{check.status}{check.code ? ` · ${check.code}` : ''}</td><td>{check.durationMs} ms</td></tr>)}</tbody></table><small>Checked {new Date(report.at).toLocaleTimeString()}. Token checks do not prove speech recognition.</small></>}
    <h4>Device mock checklist</h4>
    <label><input type="checkbox" checked={mock} onChange={event => setMock(event.target.checked)} />This is a mock session, not a real interview. I permit an intentional transcription disconnect.</label>
    <p>Start the checklist before your mock, speak on each enabled input, share a coding window, and request guidance. Then test reconnection and verify newly spoken words. Screen-only/microphone-only sessions deliberately do not pass the full dual-input checklist.</p>
    <button type="button" disabled={!mock || !diagnostics.enabled} onClick={() => { setSince(Date.now()); setCheckSession(diagnostics.sessionId); setObserved([]); setReviewed(false); setStopVerified(false) }}>Begin a new device checklist</button>
    <button type="button" disabled={!mock || since === null} onClick={() => { const count = testAsrRecovery(); setError(count ? `${count} transcription connection(s) interrupted for the mock. Physical capture is not restarted; verify new words after reconnection.` : 'No active transcription connection is available to test.') }}>Test transcription reconnection</button>
    {!diagnostics.enabled && <p>Device event checks are unavailable while diagnostics are disabled. No results will be inferred.</p>}
    {checks && <><ul>{checks.map(check => <li key={check.label}>{check.passed ? 'Observed' : 'Not yet observed'} — {check.label}</li>)}</ul><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed transcript accuracy and answer usefulness during a full 45-minute mock.</label><label><input type="checkbox" checked={stopVerified} onChange={event => setStopVerified(event.target.checked)} />I tested Stop, permission denial, and channel retry; capture did not unexpectedly restart.</label><p role="status">{checks.every(check => check.passed) && reviewed && stopVerified ? 'Device checklist complete based on events and your attestations—not independent verification.' : 'Device acceptance incomplete.'}</p></>}
  </section>
}
