'use client'
import type { calculateBenchmarks, ExpectedEvent, Target } from '@/lib/rehearsal/metrics'
export type Metrics=ReturnType<typeof calculateBenchmarks>
const ms=(n:number|null)=>n===null?'Not measured':`${Math.round(n)} ms`
const pct=(n:number|null)=>n===null?'Unscored':`${(100*n).toFixed(1)}%`
export function BenchmarkPanel({metrics}:{metrics:Metrics}) {
  return <section aria-label="Rehearsal benchmarks" className="space-y-2 rounded-xl border p-4">
    <h2 className="text-xl font-semibold">Session metrics</h2>
    <p className="text-sm">Client observations · {metrics.protocol} · p95 below 20 samples is unstable. No readiness score is inferred.</p>
    <p>{metrics.requests} requests · {metrics.complete} complete · {metrics.failed} failed · {metrics.cancelled} cancelled · {metrics.stale} stale · {metrics.running} running</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Lane</th><th>Samples</th><th>First text p50</th><th>First text p95</th><th>Completion p95</th></tr></thead><tbody>{metrics.lanes.map(l=><tr key={l.lane}><td className="py-2">{l.lane}</td><td>{l.firstText.samples}</td><td>{ms(l.firstText.p50Ms)}</td><td>{ms(l.firstText.p95Ms)}</td><td>{ms(l.completion.p95Ms)}</td></tr>)}</tbody></table></div>
    <p className="text-sm">Latency starts at request dispatch, not speech end. First text may not yet be useful. Guide/review return structured output, so first-text samples can be absent.</p>
    <p>Human review: {metrics.humanReview.reviewed}/{metrics.humanReview.completed} completed responses · {pct(metrics.humanReview.passRateAmongReviewed)} pass among reviewed only.</p>
    <p>Expected question coverage: {pct(metrics.questionCoverage.recall)} · Requirement coverage: {pct(metrics.requirementCoverage.recall)}</p>
    <p className="text-sm">Word error rate, wrong-speaker rate, duplicate-trigger rate, verified test pass rate, provider cost, and speech-end latency require independent evidence; none is guessed.</p>
  </section>
}
export function ExpectedEvents({events,targets,onChange}:{events:ExpectedEvent[];targets:Target[];onChange:(next:ExpectedEvent[])=>void}) {
  const change=(id:string,patch:Partial<ExpectedEvent>)=>onChange(events.map(e=>e.id===id?{...e,...patch}:e))
  return <section className="space-y-3 rounded-xl border p-4"><h2 className="text-xl font-semibold">Independent expected events</h2><p>After the run, add questions and requirements from your independent record, including missed ones. Do not use the agent transcript as ground truth. No score appears until every listed event is reviewed; the list itself may still be incomplete.</p>
    {events.map(e=><fieldset key={e.id} className="space-y-2 rounded-lg border p-3"><label className="block">Event type<select aria-label="Event type" value={e.kind} onChange={x=>change(e.id,{kind:x.target.value as ExpectedEvent['kind'],matchedId:'',verdict:'unreviewed'})}><option value="question">Question</option><option value="requirement">Requirement</option></select></label><label className="block">Expected words<input className="w-full border p-2" maxLength={1000} value={e.text} onChange={x=>change(e.id,{text:x.target.value})}/></label>
      <label className="block">Detection verdict<select aria-label="Detection verdict" value={e.verdict} onChange={x=>change(e.id,{verdict:x.target.value as ExpectedEvent['verdict'],matchedId:''})}><option value="unreviewed">Not reviewed</option><option value="detected">Detected</option><option value="missed">Missed</option></select></label>
      {e.verdict==='detected'&&<label className="block">Match observed event<select aria-label="Match observed event" className="max-w-full" value={e.matchedId} onChange={x=>change(e.id,{matchedId:x.target.value})}><option value="">Select observed evidence</option>{targets.filter(t=>t.kind===e.kind).map(t=><option key={t.id} value={t.id}>{t.text.slice(0,110)}</option>)}</select></label>}
      <button className="btn-ghost" onClick={()=>onChange(events.filter(x=>x.id!==e.id))}>Remove expected event</button></fieldset>)}
    <button className="btn-ghost" disabled={events.length>=200} onClick={()=>onChange([...events,{id:crypto.randomUUID(),kind:'question',text:'',verdict:'unreviewed',matchedId:''}])}>Add expected event</button>
  </section>
}
