'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { runPublicBenchmark, type BenchmarkRow } from '@/lib/repo/live/benchmark'
import styles from './RepositoryWorkspace.module.css'

export function RepositoryBenchmarks() {
  const [approved, setApproved] = useState(false), [running, setRunning] = useState(false), [rows, setRows] = useState<BenchmarkRow[]>([]), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; controller.current?.abort() }, [])
  async function run() {
    if (!approved || controller.current) return
    const current = new AbortController(), token = ++generation.current
    controller.current = current; setRunning(true); setRows([]); setError('')
    try { await runPublicBenchmark(current.signal, row => { if (token === generation.current) setRows(previous => [...previous, row]) }) }
    catch { if (token === generation.current) setError('Benchmark stopped. Completed rows are retained.') }
    finally { if (token === generation.current) { controller.current = null; setRunning(false) } }
  }
  function download() {
    const report = { schema: 1, generatedAt: new Date().toISOString(), workload: 'three public synthetic repository smoke cases', modelsCalled: true, maximumRequests: 6, correctnessVerifiedByExecution: false, rows }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'live-repository-model-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <WorkspaceShell active="repository"><main className={styles.page}>
    <header className={styles.header}><div><h1>Repository model benchmarks</h1><p className={styles.subtitle}>Test the same speech and code endpoints used by the live workspace.</p></div><div className={styles.links}><Link href="/interview/replay">Offline replay</Link><Link href="/interview/repository">Live workspace</Link></div></header>
    <section className={styles.setup}><h2>Measure actual model responses.</h2><p>This test sends three public synthetic source examples to the configured models. It makes at most six model requests, costs provider tokens, and requires sign-in. It does not use your resume, screen, microphone, private repository or saved interviews.</p>
      <label><input type="checkbox" checked={approved} disabled={running} onChange={e => setApproved(e.target.checked)} /><span>I approve six bounded model requests using these public fixtures. I understand that this measures contract compliance and request latency, not verified patch correctness.</span></label>
      <div className={styles.controls}><button className={`${styles.button} ${styles.primary}`} disabled={!approved || running} onClick={() => void run()}>Run 3 model trials</button>{running && <button className={styles.button} onClick={() => controller.current?.abort()}>Stop benchmark</button>}<button className={styles.button} disabled={!rows.length || running} onClick={download}>Export actual results</button></div>
      <p role="status" className={styles.subtitle}>{rows.length}/3 cases completed. Changing the server’s speech/code model settings lets you compare exported runs. No model is automatically promoted.</p>
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {rows.map(row => <section key={row.id} className={styles.card} style={{ marginTop: 16 }}><h2>{row.id} · {row.status}</h2>{row.error ? <p className={styles.error}>{row.error}</p> : <>
      <p className={styles.muted}>Speech: {row.speechModel} · code: {row.codeModel} · first text {row.firstTextMs === null ? 'unavailable' : `${row.firstTextMs} ms`} · both lanes completed {row.elapsedMs} ms after request start.</p>
      <h3>Say now</h3><p className={styles.body}>{row.say}</p><h3>Proposed change</h3><p className={styles.body}>{row.plan?.summary}</p>{row.plan?.edits.map((edit, i) => <div key={i}><p className={styles.path}>{edit.path}</p><pre className={styles.code}><code>{edit.after}</code></pre></div>)}
      <h3>Contract checks — not a correctness verdict</h3><ul className={styles.list}>{Object.entries(row.evaluation?.checks ?? {}).map(([name, pass]) => <li key={name}>{pass ? 'Pass' : 'Needs review'}: {name}</li>)}</ul><p className={styles.muted}>{row.evaluation?.note}</p>
    </>}</section>)}
  </main></WorkspaceShell>
}
