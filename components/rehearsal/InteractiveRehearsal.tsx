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
import { DEFAULT_METADATA, type BenchmarkMetadata, type ExpectedEvent, type Target } from '@/lib/rehearsal/metrics'
import { saveRehearsal, listRehearsals, deleteRehearsal, type ArchivedRehearsal } from '@/lib/rehearsal/archive'
import { youtubeReference } from '@/lib/interview/videoReference'
import { BenchmarkPanel, ExpectedEvents } from './BenchmarkPanel'

function downloadJSON(content:string,name:string) {
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a')
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function InteractiveRehearsal({ ownerId = 'local-rehearsal' }: { ownerId?: string }) {
  return <OwnedRehearsal key={ownerId} ownerId={ownerId}/>
}
function OwnedRehearsal({ ownerId }: { ownerId: string }) {
  const [selectedLessons,setSelectedLessons] = useState<LessonId[]>([])
  const [endedSession,setEndedSession]=useState<{controller:CoachController;state:CoachState}|null>(null)
  const [preflight,setPreflight]=useState<ReturnType<typeof rehearsalPreflight>|null>(null)
  const [message,setMessage]=useState(''),[active,setActive]=useState(false),[records,setRecords]=useState<ResultRecord[]>([])
  const [targets,setTargets]=useState<Target[]>([]),[runSplit,setRunSplit]=useState<BenchmarkMetadata['split']>('tuning')
  const [hasSession,setHasSession]=useState(false),[reviews,setReviews]=useState<HumanReview[]>([]),[expected,setExpected]=useState<ExpectedEvent[]>([])
  const [metadata,setMetadata]=useState<BenchmarkMetadata>({...DEFAULT_METADATA})
  const [saveEnabled,setSaveEnabled]=useState(true),[saveStatus,setSaveStatus]=useState('No session saved yet.'),[storageError,setStorageError]=useState('')
  const [archive,setArchive]=useState<ArchivedRehearsal[]>([]),[viewArchive,setViewArchive]=useState<string|null>(null)
  const [exportConsent,setExportConsent]=useState(false),[metrics,setMetrics]=useState(()=>new RehearsalReport().getMetrics())
  const report=useRef(new RehearsalReport()),coach=useRef<CoachController|null>(null),unsubscribe=useRef<(()=>void)|null>(null)
  const runConfig=useRef<ReturnType<typeof rehearsalPreflight>|null>(null)
  const checking=useRef<AbortController|null>(null),dirty=useRef(false),saveQueue=useRef(Promise.resolve()),mounted=useRef(true)
  const flags=useRef({active,saveEnabled,preflight,reviews,expected})
  useEffect(()=>{flags.current={active,saveEnabled,preflight,reviews,expected}},[active,saveEnabled,preflight,reviews,expected])
  const refreshArchive=useCallback(async()=>{try{const rows=await listRehearsals(ownerId);if(mounted.current)setArchive(rows)}catch(e){if(mounted.current)setStorageError(e instanceof Error?e.message:'Archive unavailable.')}},[ownerId])
  const snapshot=useCallback(()=>{
    const f=flags.current
    if(!coach.current||!runConfig.current)return null
    const data=JSON.parse(report.current.export(runConfig.current.commit,coach.current.exportReplay(),f.reviews,f.expected))
    data.configuration=runConfig.current // Presence/model IDs only; never secret values.
    return JSON.stringify(data,null,2)
  },[])
  const flush=useCallback(()=>{
    if(!dirty.current)return
    const f=flags.current
    setMetrics(report.current.getMetrics(f.reviews,f.expected))
    const content=snapshot()
    if(!content||!f.saveEnabled)return
    dirty.current=false
    // Serialized snapshots prevent an earlier streaming save from overwriting End/review.
    saveQueue.current=saveQueue.current.then(()=>saveRehearsal(ownerId,content)).then(()=>{
      if(mounted.current){setStorageError('');setSaveStatus(`Saved on this laptop at ${new Date().toLocaleTimeString()}`);if(!flags.current.active)void refreshArchive()}
    }).catch(e=>{dirty.current=true;if(mounted.current)setStorageError(e instanceof Error?e.message:'Save failed. Export before leaving.')})
  },[ownerId,refreshArchive,snapshot])
  useEffect(()=>{
    mounted.current=true;const kickoff=setTimeout(()=>void refreshArchive(),0)
    const timer=setInterval(flush,2000)
    const hide=()=>{if(document.visibilityState==='hidden')flush()}
    document.addEventListener('visibilitychange',hide)
    return()=>{unsubscribe.current?.();checking.current?.abort();clearInterval(timer);clearTimeout(kickoff);document.removeEventListener('visibilitychange',hide);mounted.current=false}
  },[refreshArchive,flush])
  useEffect(()=>{if(!hasSession)return;dirty.current=true;const timer=setTimeout(flush,0);return()=>clearTimeout(timer)},[reviews,expected,saveEnabled,hasSession,flush])
  const ready=useCallback<NonNullable<RepositoryCoachProps['onReady']>>(({controller})=>{
    unsubscribe.current?.()
    const canonical={...metadata,sourceUrl:metadata.sourceUrl?youtubeReference(metadata.sourceUrl).url:''}
    report.current=new RehearsalReport(selectedLessons,canonical)
    runConfig.current=flags.current.preflight;setRunSplit(canonical.split);setTargets([])
    report.current.observe(controller.getSnapshot())
    flags.current={...flags.current,reviews:[],expected:[]}
    setReviews([]);setExpected([]);setRecords([]);setExportConsent(false);setEndedSession(null);setHasSession(true);setViewArchive(null)
    coach.current=controller;dirty.current=true
    unsubscribe.current=controller.subscribe(()=>{report.current.observe(controller.getSnapshot());dirty.current=true})
  },[selectedLessons,metadata])
  const audio=useCallback((event:AudioEvidence)=>{report.current.observeAudio(event);dirty.current=true},[])
  const activity=useCallback((value:boolean)=>{
    flags.current.active=value;setActive(value)
    if(!value&&coach.current){coach.current.end();report.current.observe(coach.current.getSnapshot());setRecords(report.current.getResults());setTargets(report.current.getTargets());setEndedSession({controller:coach.current,state:coach.current.getSnapshot()});dirty.current=true;flush()}
  },[flush])
  useEffect(()=>{
    if(active||!endedSession)return
    for(const review of reviews)endedSession.controller.feedback(review.resultId,review.verdict,[review.category],review.note)
  },[reviews,active,endedSession])
  async function check() {
    checking.current?.abort();const abort=new AbortController();checking.current=abort;setMessage('Checking test configuration; no model calls…')
    try{const r=await fetch('/api/rehearsal/preflight',{method:'POST',signal:abort.signal});const data=await r.json();if(abort.signal.aborted)return
      if(!r.ok)throw new Error(data.error||'Preflight failed')
      setPreflight(data);setMessage(data.ready?'Configured. Credentials and accuracy still need a real run.':'Blocked: configure the missing speech/vision/coach providers in this test environment, then redeploy.')
    }catch(e){if(!abort.signal.aborted)setMessage(e instanceof Error?e.message:'Preflight failed')}
  }
  let setupError=''
  try{if(metadata.sourceUrl)youtubeReference(metadata.sourceUrl)}catch{setupError='Use one HTTPS YouTube video link, not a playlist.'}
  if(!Number.isFinite(metadata.startSeconds)||metadata.startSeconds<0||metadata.endSeconds!==null&&(!Number.isFinite(metadata.endSeconds)||metadata.endSeconds<=metadata.startSeconds))setupError='Use a valid excerpt range with end after start.'
  const summaryState=endedSession?{...endedSession.state,feedback:reviews.map((r,index)=>({id:`review-${index}`,resultId:r.resultId,verdict:r.verdict,categories:[r.category],note:r.note,at:0}))}:null
  const selected=archive.find(a=>a.sessionId===viewArchive)
  const selectedData=selected?JSON.parse(selected.report):null
  const recordReview=(r:ResultRecord,patch:Partial<HumanReview>)=>setReviews(v=>[...v.filter(x=>x.resultId!==r.id),{resultId:r.id,verdict:'needs-work',category:'correctness',note:'',...v.find(x=>x.resultId===r.id),...patch}])
  return <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Interactive rehearsal</h1><p className="mt-2">Play the interview continuously on your laptop, or work with a real interviewer. Lessons stay frozen. No automatic promotion.</p></header>
    <section className="rounded-xl border p-4"><button className="btn-ghost" disabled={active} onClick={()=>void check()}>Check test configuration</button><p role="status">{message}</p>
      {preflight&&<div className="mt-3 text-sm"><p>Source commit: {preflight.commit}</p><p>Speech: Deepgram {preflight.speech.deepgram?'configured':'missing'} · AssemblyAI {preflight.speech.assemblyai?'configured':'missing'}</p>{preflight.models.map(m=><p key={m.lane}>{m.lane}: {m.model} · {m.configured?'configured':'missing'}</p>)}</div>}
    </section>
    <fieldset disabled={active} className="space-y-2 rounded-xl border p-4"><legend>Benchmark setup</legend>
      <label className="block">Session title<input className="ml-2 max-w-full border p-2" maxLength={140} value={metadata.title} onChange={e=>setMetadata({...metadata,title:e.target.value})}/></label>
      <label className="block">Run type<select value={metadata.kind} onChange={e=>setMetadata({...metadata,kind:e.target.value as BenchmarkMetadata['kind']})}><option value="video-replay">Continuous video replay</option><option value="interactive">Interactive repository rehearsal</option></select></label>
      <label className="block">Video reference (optional)<input className="w-full border p-2" type="url" maxLength={500} value={metadata.sourceUrl} onChange={e=>setMetadata({...metadata,sourceUrl:e.target.value})}/></label>
      <label className="mr-4 inline-block">Split<select value={metadata.split} onChange={e=>setMetadata({...metadata,split:e.target.value as BenchmarkMetadata['split']})}><option value="tuning">Tuning</option><option value="holdout">Holdout — do not tune on this run</option></select></label>
      <label className="mr-4 inline-block">Playback speed<select value={metadata.playbackRate} onChange={e=>setMetadata({...metadata,playbackRate:Number(e.target.value)})}>{[.5,1,1.25,1.5,2].map(r=><option key={r} value={r}>{r}×</option>)}</select></label>
      <label className="mr-4 inline-block">Excerpt start (seconds)<input className="w-24 border p-2" type="number" min={0} value={metadata.startSeconds} onChange={e=>setMetadata({...metadata,startSeconds:Number(e.target.value)})}/></label>
      <label className="inline-block">Excerpt end (optional)<input className="w-24 border p-2" type="number" min={0} value={metadata.endSeconds??''} onChange={e=>setMetadata({...metadata,endSeconds:e.target.value===''?null:Number(e.target.value)})}/></label>
      <p className="text-sm">Use 1× without pausing for the agent. Metadata does not control or synchronize YouTube. Reusing a tuning video does not create an unseen holdout.</p>{setupError&&<p role="alert">{setupError}</p>}
      <label className="block"><input type="checkbox" checked={saveEnabled} onChange={e=>setSaveEnabled(e.target.checked)}/> Save text evidence automatically on this laptop: transcript, code snippets, answers, metrics and reviews. No raw audio/video.</label>
    </fieldset>
    <p role="status">{saveStatus}</p>{storageError&&<p role="alert">{storageError}</p>}
    <p>Share the video tab with audio and select the coding screen in the coach. In a video, both people arrive on the call channel: choose the interviewer voice. Keep independent expectations and reviewer tests off the shared screen.</p>
    {preflight?.ready&&<fieldset disabled={active} className="rounded-xl border p-4"><legend>Frozen rehearsal policy</legend><p>Base policy is the default. Tactics are frozen per run. Nothing is promoted by selecting them.</p><p className="break-all text-sm">{policyKey(selectedLessons)}</p>{Object.entries(LESSONS).map(([id,lesson])=><label key={id} className="mr-4 block"><input type="checkbox" checked={selectedLessons.includes(id as LessonId)} disabled={active||(!selectedLessons.includes(id as LessonId)&&selectedLessons.length>=4)} onChange={e=>setSelectedLessons(lessonIds(e.target.checked?[...selectedLessons,id]:selectedLessons.filter(x=>x!==id)))}/>{lesson.label}</label>)}</fieldset>}
    {preflight?.ready&&<LiveInterview frozenLessons={selectedLessons} rehearsal visible blocked={!!setupError} onActivity={activity} onComplete={session=>{report.current.finishTranscript(session.transcript);dirty.current=true;setMessage('Capture ended. Review against independent expectations and current tests.')}} onCoachReady={ready} onAudioEvidence={audio}/>}
    {hasSession&&<BenchmarkPanel metrics={metrics}/>}
    {!active&&records.length>0&&<section aria-label="Independent rehearsal review" className="space-y-3"><h2 className="text-xl font-semibold">Review after the run</h2><p>Review all outputs, including cancelled/stale ones. A model-name label does not certify real inference. A human pass is not proof of executed tests.</p>{records.map(r=><details key={r.id} className="rounded-lg border p-3"><summary>{r.lane} · {r.status} · {r.model||'No model returned'}</summary><pre className="whitespace-pre-wrap break-words">{r.text||r.guidance?.summary||r.error}</pre>
      <label>Outcome<select className="ml-2 border p-2" value={reviews.find(x=>x.resultId===r.id)?.verdict||''} onChange={e=>{if(e.target.value)recordReview(r,{verdict:e.target.value as HumanReview['verdict']})}}><option value="">Not reviewed</option><option value="pass">Useful and supported</option><option value="needs-work">Needs work</option></select></label>
      <label className="block">Failure category<select value={reviews.find(x=>x.resultId===r.id)?.category||'correctness'} onChange={e=>recordReview(r,{category:e.target.value})}>{['correctness','requirement-tracking','wrong-speaker','duplicate-answer','navigation','stale-context','latency','verbosity'].map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="mt-2 block">Evidence / failure and expected behavior<textarea aria-label={`Review note ${r.id}`} className="w-full border p-2" maxLength={1500} value={reviews.find(x=>x.resultId===r.id)?.note||''} onChange={e=>recordReview(r,{note:e.target.value})}/></label></details>)}</section>}
    {!active&&hasSession&&<ExpectedEvents events={expected} targets={targets} onChange={setExpected}/>}
    {!active&&endedSession&&summaryState&&runSplit==='tuning'&&<LearningProvider ownerId={ownerId}><LearningPanel controller={endedSession.controller} state={summaryState}/></LearningProvider>}
    {!active&&hasSession&&runSplit==='holdout'&&<p>Holdout run: lesson tuning is disabled here. Keep this evidence for independent comparison.</p>}
    <label className="block"><input type="checkbox" checked={exportConsent} onChange={e=>setExportConsent(e.target.checked)}/> I have reviewed the export scope: source snippets, transcript text, agent responses and review notes. No raw audio/images are included.</label>
    <button className="btn-ghost" disabled={active||!hasSession||!exportConsent} onClick={()=>{const raw=snapshot();if(raw)downloadJSON(raw,`rehearsal-${coach.current?.sessionId}.json`)}}>Export rehearsal evidence</button>
    <section className="space-y-3 rounded-xl border p-4" aria-label="Saved sessions"><h2 className="text-xl font-semibold">Saved sessions on this laptop</h2><p className="text-sm">Use the same browser profile and Preview branch URL to retain this archive. It is not cloud sync, encrypted storage, or a raw recording. Abrupt closure can lose the last two seconds. Export backups before clearing browser data.</p><button className="btn-ghost" onClick={()=>void refreshArchive()}>Refresh saved sessions</button>
      {archive.length===0&&<p>No saved sessions for this account and site.</p>}
      {archive.map(a=><div className="flex flex-wrap items-center gap-2 border-t py-2" key={a.sessionId}><span className="min-w-0 break-words">{a.title} · {a.ended?'Ended':'Recovered / incomplete'} · {new Date(a.updatedAt).toLocaleString()}</span><button className="btn-ghost" onClick={()=>setViewArchive(a.sessionId)}>View saved report</button><button className="btn-ghost" onClick={()=>{if(window.confirm('Download transcript, selected source, model output and reviews? Inspect before sharing.'))downloadJSON(a.report,`rehearsal-${a.sessionId}.json`)}}>Download saved session</button><button className="btn-ghost" disabled={active} onClick={()=>{if(window.confirm('Delete this saved session from this browser? This cannot be undone.'))void deleteRehearsal(ownerId,a.sessionId).then(()=>{setViewArchive(null);return refreshArchive()}).catch(e=>setStorageError(String(e.message)))}}>Delete saved session</button></div>)}
      {selectedData&&<div><h3 className="text-lg font-semibold">Read-only saved report: {selected?.title}</h3><p>Viewing does not resume capture, call a model, or feed prior answers into Live.</p>{selectedData.benchmarks&&<BenchmarkPanel metrics={selectedData.benchmarks}/>}<details><summary>Saved transcript and agent responses</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{selectedData.finalTranscript||selectedData.conversation?.map((d:{role:string;text:string})=>`${d.role}: ${d.text}`).join('\n')}{'\n\n'}{selectedData.results?.map((r:ResultRecord)=>`${r.lane} / ${r.status}\n${r.text||r.guidance?.summary||r.error||''}`).join('\n\n')}</pre></details></div>}
    </section>
    <p className="text-sm">Reports are never automatically sent to GitHub or used for training. Provider charges apply to capture/answers. Saving and viewing reports makes no model calls.</p>
  </main>
}
