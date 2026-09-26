'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveInterview } from '@/components/interview/LiveInterview'
import type { RepositoryCoachProps } from '@/components/coach/RepositoryCoach'
import { RehearsalReport, type AudioEvidence, type HumanReview } from '@/lib/rehearsal/report'
import { LearningProvider } from '@/lib/coach/learning/LearningContext'
import { LearningPanel } from '@/components/coach/LearningPanel'
import { LESSONS, lessonIds, policyKey, type LessonId } from '@/lib/coach/learning/policy'
import type { CoachState, ResultRecord } from '@/lib/coach/types'
import type { CoachController } from '@/lib/coach/controller'
import type { rehearsalPreflight } from '@/lib/rehearsal/preflight'

export function InteractiveRehearsal({ ownerId = 'local-rehearsal' }: { ownerId?: string }) {
  const [selectedLessons,setSelectedLessons] = useState<LessonId[]>([])
  const [endedSession,setEndedSession]=useState<{ controller:CoachController; state:CoachState }|null>(null)
  const [preflight,setPreflight] = useState<ReturnType<typeof rehearsalPreflight>|null>(null)
  const [message,setMessage] = useState(''), [active,setActive]=useState(false), [records,setRecords]=useState<ResultRecord[]>([])
  const [hasSession,setHasSession]=useState(false)
  const [reviews,setReviews]=useState<HumanReview[]>([]),[exportConsent,setExportConsent]=useState(false)
  const report=useRef(new RehearsalReport()), coach=useRef<CoachController|null>(null), unsubscribe=useRef<(()=>void)|null>(null)
  const checking=useRef<AbortController|null>(null)
  useEffect(()=>()=>{unsubscribe.current?.();checking.current?.abort()},[])
  const ready=useCallback<NonNullable<RepositoryCoachProps['onReady']>>(({controller})=>{
    unsubscribe.current?.();report.current=new RehearsalReport(selectedLessons);setReviews([]);setRecords([]);setExportConsent(false);setEndedSession(null);setHasSession(true);coach.current=controller
    unsubscribe.current=controller.subscribe(()=>report.current.observe(controller.getSnapshot()))
  },[selectedLessons])
  const audio=useCallback((event:AudioEvidence)=>report.current.observeAudio(event),[])
  const activity=useCallback((value:boolean)=>{
    setActive(value)
    if(!value&&coach.current){coach.current.end();report.current.observe(coach.current.getSnapshot());setRecords(report.current.getResults());setEndedSession({controller:coach.current,state:coach.current.getSnapshot()})}
  },[])
  useEffect(()=>{
    if(active || !endedSession)return
    for(const review of reviews)endedSession.controller.feedback(review.resultId,review.verdict,[review.category],review.note)
  },[reviews,active,endedSession])
  async function check() {
    checking.current?.abort();const abort=new AbortController();checking.current=abort;setMessage('Checking test configuration; no model calls…')
    try {
      const r=await fetch('/api/rehearsal/preflight',{method:'POST',signal:abort.signal})
      const data=await r.json()
      if(abort.signal.aborted)return
      if(!r.ok)throw new Error(data.error||'Preflight failed')
      setPreflight(data);setMessage(data.ready?'Configured. Credentials and accuracy still need a real run.':'Blocked: configure the missing speech/vision/coach providers in this test environment, then redeploy.')
    } catch(e){if(!abort.signal.aborted)setMessage(e instanceof Error?e.message:'Preflight failed')}
  }
  const summaryState=endedSession ? { ...endedSession.state, feedback:reviews.map((review,index)=>({id:`review-${index}`,resultId:review.resultId,verdict:review.verdict,categories:[review.category],note:review.note,at:0})) } : null
  function download() {
    if(!coach.current||!preflight||active||!exportConsent)return
    const content=report.current.export(preflight.commit,coach.current.exportReplay(),reviews)
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='interactive-rehearsal.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Interactive rehearsal</h1><p className="mt-2">Real participants, your IDE, and the existing speech/vision/coach pipeline. No scripted answers. Lessons stay frozen; no automatic promotion.</p></header>
    <section className="rounded-xl border p-4"><button className="btn-ghost" disabled={active} onClick={()=>void check()}>Check test configuration</button><p role="status">{message}</p>
      {preflight&&<div className="mt-3 text-sm"><p>Source commit: {preflight.commit}</p><p>Speech: Deepgram {preflight.speech.deepgram?'configured':'missing'} · AssemblyAI {preflight.speech.assemblyai?'configured':'missing'}</p>{preflight.models.map(m=><p key={m.lane}>{m.lane}: {m.model} · {m.configured?'configured':'missing'}</p>)}</div>}
    </section>
    <p>Use the supplied starter repository. Have a second person ask questions and change requirements while you edit and run tests. Start capture below, select the interviewer voice, then share only the permitted IDE. Keep reviewer expectations outside the shared screen and model context.</p>
    {preflight?.ready&&<fieldset disabled={active} className="rounded-xl border p-4"><legend>Frozen rehearsal policy</legend><p>Base policy is the default. To rehearse a judged candidate, select its exact tactics before starting; nothing is promoted by this selection.</p><p className="break-all text-sm">{policyKey(selectedLessons)}</p>{Object.entries(LESSONS).map(([id,lesson])=><label key={id} className="mr-4 block"><input type="checkbox" checked={selectedLessons.includes(id as LessonId)} disabled={active||(!selectedLessons.includes(id as LessonId)&&selectedLessons.length>=4)} onChange={e=>setSelectedLessons(lessonIds(e.target.checked?[...selectedLessons,id]:selectedLessons.filter(x=>x!==id)))}/>{lesson.label}</label>)}</fieldset>}
    {preflight?.ready&&<LiveInterview frozenLessons={selectedLessons} rehearsal visible blocked={false} onActivity={activity} onComplete={()=>{setMessage('Capture ended. Review the generated responses and independent test output before exporting; no accuracy score is inferred.')}} onCoachReady={ready} onAudioEvidence={audio}/>}
    {!active&&records.length>0&&<section aria-label="Independent rehearsal review" className="space-y-3"><h2 className="text-xl font-semibold">Review after the run</h2><p>Compare each response with the prompt as it existed then. Passing an answer is a human judgment, not a test-execution certificate.</p>{records.map(r=><details key={r.id} className="rounded-lg border p-3"><summary>{r.lane} · {r.status} · {r.model||'No model returned'}</summary><pre className="whitespace-pre-wrap break-words">{r.text||r.guidance?.summary||r.error}</pre><label>Outcome<select className="ml-2 border p-2" value={reviews.find(x=>x.resultId===r.id)?.verdict||''} onChange={e=>{if(!e.target.value)return;setReviews(v=>[...v.filter(x=>x.resultId!==r.id),{resultId:r.id,verdict:e.target.value as HumanReview['verdict'],category:'correctness',note:v.find(x=>x.resultId===r.id)?.note||''}])}}><option value="">Not reviewed</option><option value="pass">Useful and supported</option><option value="needs-work">Needs work</option></select></label><label className="mt-2 block">Evidence / failure and expected behavior<textarea aria-label={`Review note ${r.id}`} className="w-full border p-2" maxLength={1500} value={reviews.find(x=>x.resultId===r.id)?.note||''} onChange={e=>setReviews(v=>[...v.filter(x=>x.resultId!==r.id),{resultId:r.id,verdict:v.find(x=>x.resultId===r.id)?.verdict||'needs-work',category:'correctness',note:e.target.value}])}/></label></details>)}</section>}
    {!active&&endedSession&&summaryState&&<LearningProvider ownerId={ownerId}><LearningPanel controller={endedSession.controller} state={summaryState}/></LearningProvider>}
    <label className="block"><input type="checkbox" checked={exportConsent} onChange={e=>setExportConsent(e.target.checked)}/> I have reviewed the export scope: source snippets, transcript text, agent responses and review notes. No raw audio/images are included.</label>
    <button className="btn-ghost" disabled={active||!hasSession||!exportConsent} onClick={download}>Export rehearsal evidence</button>
    <p className="text-sm">No data is automatically uploaded to GitHub or used to train models. Provider charges apply to capture/answers. A real-time recording test and an interactive editing rehearsal test different capabilities.</p>
  </main>
}
