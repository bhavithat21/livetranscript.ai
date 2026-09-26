'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoachController } from '@/lib/coach/controller'
import type { CoachState } from '@/lib/coach/types'
import { useLessonPolicy } from '@/lib/coach/learning/LearningContext'
import { CASES, REPETITIONS, LESSONS, diagnostics, lessonIds, parseComparison, promotionGate, type Comparison, type LessonId } from '@/lib/coach/learning/policy'
import styles from './RepositoryCoach.module.css'

export async function lessonRequest(body:Record<string,unknown>,signal:AbortSignal) {
  const response=await fetch('/api/copilot/lessons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])})
  const raw=await response.text()
  if(raw.length>30_000) throw new Error('Lesson response exceeded its budget.')
  const value=JSON.parse(raw)
  if(!response.ok) throw new Error(typeof value.error==='string'?value.error:'Lesson evaluation unavailable.')
  return value
}
export function LearningPanel({controller,state}:{controller:CoachController;state:CoachState}) {
  const policy=useLessonPolicy()
  const [automatic,setAutomatic]=useState(false),[busy,setBusy]=useState(false)
  const [reviewed,setReviewed]=useState(false),[reviewNote,setReviewNote]=useState(''),[evaluatedBaseline,setEvaluatedBaseline]=useState<LessonId[]>([])
  const [message,setMessage]=useState(''),[rows,setRows]=useState<Comparison[]>([]),[candidate,setCandidate]=useState<LessonId[]>([])
  const flight=useRef<AbortController|null>(null),attempted=useRef(''),mounted=useRef(true)
  const summary=diagnostics(state),diagnosticKey=JSON.stringify(summary),running=state.status==='running'
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;flight.current?.abort()}},[])
  useEffect(()=>{if(running) flight.current?.abort()},[running])
  const learn=useCallback(async()=>{
    if(!policy||flight.current||controller.getSnapshot().status==='running') return
    const abort=new AbortController();flight.current=abort
    setBusy(true);setRows([]);setCandidate([]);setReviewed(false);setReviewNote('');setMessage('Proposing one lesson from aggregate feedback…')
    const baseline=[...policy.state.active],completed:Comparison[]=[]
    setEvaluatedBaseline(baseline)
    try {
      const proposal=await lessonRequest({action:'propose',active:baseline,diagnostics:JSON.parse(diagnosticKey)},abort.signal)
      const next=lessonIds(proposal.candidate)
      if(!mounted.current||abort.signal.aborted) return
      setCandidate(next)
      for(let repetition=0;repetition<REPETITIONS;repetition++) for(const caseId of CASES) {
        if(controller.getSnapshot().status==='running') abort.abort()
        abort.signal.throwIfAborted()
        setMessage(`Checking ${caseId} · ${completed.length+1}/${CASES.length*REPETITIONS}`)
        const result=await lessonRequest({action:'evaluate',active:baseline,candidate:next,caseId,repetition},abort.signal)
        abort.signal.throwIfAborted()
        completed.push(parseComparison(result.comparison))
        if(mounted.current) setRows([...completed])
      }
      abort.signal.throwIfAborted()
      if(!mounted.current||controller.getSnapshot().status==='running') return
      const gate=promotionGate(baseline,next,completed)
      setMessage(`${gate.passed?'Candidate passed the small model-evaluation suite. It is NOT activated; complete independent interactive rehearsal before approving it. ':''}${gate.reason}`)
    } catch(error) {if(mounted.current) setMessage(abort.signal.aborted?'Evaluation cancelled; active lessons unchanged.':error instanceof Error?error.message:'Evaluation failed; active lessons unchanged.')}
    finally {if(flight.current===abort) flight.current=null;if(mounted.current) setBusy(false)}
  },[policy,controller,diagnosticKey])
  useEffect(()=>{
    const key=`${state.sessionId}:${diagnosticKey}`
    if(!automatic||running||busy||(!summary.needsWork&&!summary.failed)||attempted.current===key) return
    attempted.current=key
    queueMicrotask(()=>{if(mounted.current) void learn()})
  },[automatic,running,busy,state.sessionId,diagnosticKey,summary.needsWork,summary.failed,learn])
  if(!policy) return null
  return <details className={`${styles.details} ${styles.main}`}>
    <summary>Learning loop · {policy.state.active.length} active lessons · v{policy.state.revision}</summary>
    <p className={styles.muted}>Useful / Needs work reviews become candidate tactics, not training data or proof of correctness. Evaluation uses six separate authored scenarios, twice, with the same coach models and a different blind judge. No raw session transcript, screenshot, code, or review note is sent to the lesson proposer.</p>
    <p>{summary.reviewed} reviewed responses · {summary.needsWork} need work · {summary.failed} failed requests</p>
    <label className={styles.permission}><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)} disabled={busy}/><span>Automatically propose and test lessons when paused or ended. Passing candidates still require independent rehearsal and explicit approval. Maximum 37 model calls per cycle; provider charges apply. No automatic retries.</span></label>
    <div className={styles.feedback}>
      <button className={styles.button} disabled={running||busy||(!summary.needsWork&&!summary.failed)} onClick={()=>void learn()}>Learn from feedback</button>
      {busy&&<button className={styles.button} onClick={()=>flight.current?.abort()}>Cancel evaluation</button>}
      <button className={styles.button} disabled={running||busy||policy.state.previous===null} onClick={()=>{const saved=policy.rollback();setMessage(saved?'Previous policy restored.':'Rollback is in memory; device storage failed.')}}>Roll back lessons</button>
    </div>
    {running&&<p className={styles.muted}>Pause the coach before evaluating or changing its lessons. Recording controls remain separate.</p>}
    {policy.state.active.length>0&&<ul className={styles.list}>{policy.state.active.map(id=><li key={id}>{LESSONS[id].label}</li>)}</ul>}
    {candidate.length>0 && promotionGate(evaluatedBaseline,candidate,rows).passed && <section>
      <label className={styles.permission}><input type="checkbox" checked={reviewed} disabled={running||busy} onChange={e=>setReviewed(e.target.checked)}/><span>I reviewed this exact candidate in an independent interactive rehearsal, including current requirements and actual test results. This is my attestation, not an automated certification.</span></label>
      <label>Rehearsal report identifier and evidence<textarea className={styles.input} value={reviewNote} maxLength={1000} onChange={e=>setReviewNote(e.target.value)} disabled={running||busy}/></label>
      <button className={styles.button} disabled={running||busy||!reviewed||reviewNote.trim().length<15} onClick={()=>{const saved=policy.apply(evaluatedBaseline,candidate,rows,{acknowledged:true,evidence:reviewNote});setMessage(saved?'Explicitly approved lesson candidate saved. Keep the rehearsal evidence with its report; rollback remains available.':'Approval could not be stored.');setReviewed(false)}}>Approve evaluated candidate after rehearsal</button>
    </section>}
    {candidate.length>0&&<p>Candidate: {candidate.map(id=>LESSONS[id].label).join(' · ')}</p>}
    {message&&<p role="status" className={styles.notice}>{message}</p>}
    {rows.length>0&&<details><summary>Evaluation results · {rows.length}/12</summary><ul className={styles.list}>{rows.map(row=><li key={`${row.caseId}:${row.repetition}`}><strong>{row.caseId} · run {row.repetition+1}: {row.baselineScore.toFixed(2)} → {row.candidateScore.toFixed(2)} / 4</strong>{row.note}<span className={styles.muted}>Generator: {row.model}; judge: {row.judge}. Hard checks: {row.hardPass?'passed':'failed'}.</span></li>)}</ul></details>}
    {policy.state.history.length>0&&<details><summary>Lesson audit history</summary><ul className={styles.list}>{policy.state.history.slice().reverse().map((row,i)=><li key={`${row.at}:${i}`}><strong>{row.action} · {row.rules.join(', ')||'Base policy'}</strong>{row.reason}</li>)}</ul></details>}
    <p className={styles.muted}>A lesson activates only after complete paired results, strict grounding, a quality gain, and a latency gate. Judged scores are estimates, not verified program execution. Account-scoped device memory; no model-weight updates or cross-account learning.</p>
  </details>
}
