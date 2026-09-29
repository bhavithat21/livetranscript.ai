'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { clearDiagnostics, exportDiagnostics, flushDiagnostics, getDiagnostics, getServerDiagnostics, initializeDiagnostics, recordDiagnostic, setDiagnosticsEnabled, subscribeDiagnostics } from '@/lib/diagnostics/client'
import { diagnosticCode } from '@/lib/diagnostics/schema'
import { RetryStatus } from './RetryStatus'
import styles from './Diagnostics.module.css'

/** Independent of capture state: even a failed startup leaves this available. */
export function DiagnosticsRuntime({ release }: { release?: string }) {
  const pathname = usePathname()
  const visible = /^\/(?:interview|copilot|record)(?:\/|$)/.test(pathname ?? '')
  const state = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getServerDiagnostics)
  const dialog = useRef<HTMLDialogElement>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!visible) return
    initializeDiagnostics()
    const native = '__TAURI_INTERNALS__' in window
    recordDiagnostic('app', 'start', { runtime: native ? 'desktop' : 'web', release })
    if (native) void import('@tauri-apps/api/app').then(api => api.getVersion()).then(desktopVersion => recordDiagnostic('app', 'ready', { runtime: 'desktop', desktopVersion, release })).catch(() => recordDiagnostic('app', 'error', { code: 'unavailable' }))
    const error = (event: ErrorEvent) => recordDiagnostic('app', 'error', { code: diagnosticCode(event.error) })
    const rejection = (event: PromiseRejectionEvent) => recordDiagnostic('app', 'error', { code: diagnosticCode(event.reason) })
    const online = () => { recordDiagnostic('app', 'online'); void flushDiagnostics() }
    const offline = () => recordDiagnostic('app', 'offline')
    const hide = () => { recordDiagnostic('app', 'stop'); void flushDiagnostics() }
    window.addEventListener('error', error); window.addEventListener('unhandledrejection', rejection)
    window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener('pagehide', hide)
    return () => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection); window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('pagehide', hide) }
  }, [visible, release])
  if (!visible) return null
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([exportDiagnostics()], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = `LiveTranscript-diagnostics-${state.sessionId}.json`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Diagnostic export requested. Contains metadata only.')
    } catch { setNotice('Export failed. Copy the diagnostic session ID instead.') }
  }
  async function sendTest() {
    recordDiagnostic('app', 'upload_test')
    setNotice('Sending queued metadata…')
    setNotice(await flushDiagnostics() ? 'Cloud receipt confirmed for the sent batch.' : 'No cloud receipt. Sign in and check your connection; local diagnostics remain available.')
  }
  return <div className="lt-overlay-root">
    <RetryStatus />
    <button type="button" className={styles.launcher} onClick={() => dialog.current?.showModal()}>Diagnostics{state.delivery === 'failed' ? ' · local' : ''}</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="diagnostics-heading">
      <header><h2 id="diagnostics-heading">Session diagnostics</h2><button type="button" onClick={() => dialog.current?.close()}>Close</button></header>
      <p>Capture stages, timing, counts and error categories only. No audio, images, transcripts, code, credentials, raw error messages or stacks are included in these diagnostics.</p>
      <label><input type="checkbox" checked={state.enabled} onChange={event => setDiagnosticsEnabled(event.target.checked)} /> Record and send metadata diagnostics</label>
      <p>Diagnostic session: <code>{state.sessionId || 'Not started'}</code></p>
      <p>Cloud delivery: <strong>{state.delivery}</strong> · queued {state.pending} · dropped {state.dropped}{state.lastSentAt ? ` · last receipt ${new Date(state.lastSentAt).toLocaleTimeString()}` : ''}</p>
      <p>Local retention: up to 24 hours / 600 events. Cloud retention follows the hosting plan. Reloads retain local history for export, but do not resend it. Disabling clears local history and queued uploads; it does not delete already received server logs.</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void sendTest()} disabled={!state.enabled || state.delivery === 'sending'}>Test cloud logging</button>
        <button type="button" onClick={download}>Export diagnostics</button>
        <button type="button" onClick={() => { clearDiagnostics(); setNotice('Local diagnostic history cleared; a new diagnostic session ID was created.') }}>Clear local history</button>
      </div>
      <h3>Mark what needs improvement</h3>
      <div className={styles.actions}>
        <button type="button" disabled={!state.enabled} onClick={() => { recordDiagnostic('talk', 'feedback', { verdict: 'needs-work', category: 'latency' }); setNotice('Slow-answer feedback recorded.') }}>Slow answers</button>
        <button type="button" disabled={!state.enabled} onClick={() => { recordDiagnostic('guide', 'feedback', { verdict: 'needs-work', category: 'stale-context' }); setNotice('Context feedback recorded.') }}>Wrong / stale context</button>
        <button type="button" disabled={!state.enabled} onClick={() => { recordDiagnostic('transcription', 'feedback', { verdict: 'needs-work', category: 'correctness' }); setNotice('Transcript feedback recorded.') }}>Missing transcript</button>
      </div>
      <p role="status">{notice}</p>
      <h3>Recent events</h3>
      <p>Start/ready does not prove data is flowing. Look for first frame, first final transcript, and a completed answer. Silence is not automatically an error. A missing stop event is not proof of a crash.</p>
      <div className={styles.timeline}><table><thead><tr><th>Time</th><th>Stage</th><th>Event</th><th>Metadata</th></tr></thead><tbody>{state.events.slice(-60).reverse().map(item => <tr key={`${item.sessionId}:${item.seq}`}><td>{new Date(item.at).toLocaleTimeString()}</td><td>{item.stage}</td><td>{item.event}</td><td><code>{JSON.stringify(item.attrs)}</code></td></tr>)}</tbody></table>{!state.events.length && <p>No diagnostic events recorded yet.</p>}</div>
    </dialog>
  </div>
}
