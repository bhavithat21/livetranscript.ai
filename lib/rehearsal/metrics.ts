import type { Question, ResultRecord } from '@/lib/coach/types'
import type { HumanReview } from './report'

export type BenchmarkMetadata = {
  title: string; kind: 'video-replay' | 'interactive'; sourceUrl: string
  split: 'tuning' | 'holdout'; playbackRate: number; startSeconds: number; endSeconds: number | null
}
export const DEFAULT_METADATA: BenchmarkMetadata = { title: 'Continuous interview rehearsal', kind: 'video-replay', sourceUrl: '', split: 'tuning', playbackRate: 1, startSeconds: 0, endSeconds: null }
export type ExpectedEvent = { id: string; kind: 'question' | 'requirement'; text: string; verdict: 'unreviewed' | 'detected' | 'missed'; matchedId: string }
export type Target = { id: string; kind: ExpectedEvent['kind']; text: string }
export function distribution(values: Array<number | null>) {
  const samples = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0).sort((a,b)=>a-b)
  const quantile = (p:number) => samples.length ? samples[Math.max(0, Math.ceil(p*samples.length)-1)] : null
  return { samples:samples.length, p50Ms:quantile(.5), p95Ms:quantile(.95), maxMs:quantile(1), smallSample:samples.length<20 }
}
/** Ground truth is entered AFTER the run. The agent never receives these annotations. */
export function coverage(events: ExpectedEvent[], targets: Target[], kind: ExpectedEvent['kind']) {
  const rows = events.filter(e=>e.kind===kind && e.text.trim())
  const seen = new Set<string>()
  let detected=0, missed=0, invalid=0
  for(const e of rows) {
    if(e.verdict==='missed') missed++
    else if(e.verdict==='detected') {
      if(!targets.some(t=>t.id===e.matchedId&&t.kind===kind)||seen.has(e.matchedId)) invalid++
      else { seen.add(e.matchedId); detected++ }
    }
  }
  const reviewed=detected+missed
  // No automatic denominator from the agent's own transcript. Unreviewed items
  // do not become successes; any incompleteness prevents an overall recall score.
  return { expected:rows.length, reviewed, detected, missed, invalid, unreviewed:rows.length-reviewed-invalid,
    recall:rows.length>0 && reviewed===rows.length ? detected/rows.length : null,
    basis:'human-annotated expected events; not an independently certified score' }
}
export function calculateBenchmarks(results:ResultRecord[], questions:Question[], reviews:HumanReview[], expected:ExpectedEvent[]=[], targets:Target[]=[]) {
  const validReviews=new Map(reviews.filter(r=>results.some(x=>x.id===r.resultId&&x.status==='complete')&&['pass','needs-work'].includes(r.verdict)).map(r=>[r.resultId,r]))
  const complete=results.filter(r=>r.status==='complete'), reviewed=[...validReviews.values()]
  const lanes=(['talk','guide','review'] as const).map(lane=>{
    const rows=results.filter(r=>r.lane===lane)
    return { lane, requests:rows.length,
      firstText:distribution(rows.filter(r=>r.status==='complete'&&r.text.trim()).map(r=>r.firstUsefulMs)),
      completion:distribution(rows.filter(r=>r.status==='complete').map(r=>r.totalMs)) }
  })
  const firstByQuestion=questions.map(q=>results.filter(r=>r.lane==='talk'&&r.status==='complete'&&r.questionId===q.id&&r.text.trim()&&r.firstUsefulMs!==null&&r.startedAt>=q.at)
    .map(r=>r.startedAt+r.firstUsefulMs!-q.at).sort((a,b)=>a-b)[0]??null)
  return { protocol:'continuous-interview-v1', measuredFrom:'client observations',
    requests:results.length, complete:complete.length, failed:results.filter(r=>r.status==='failed').length,
    cancelled:results.filter(r=>r.status==='cancelled').length, stale:results.filter(r=>r.status==='stale').length,
    running:results.filter(r=>r.status==='running').length, lanes,
    questionDispatchToFirstText:distribution(firstByQuestion), speechEndToFirstUsefulWords:null,
    modelNames:[...new Set(results.map(r=>r.model).filter(Boolean))],
    humanReview:{completed:complete.length,reviewed:reviewed.length,passes:reviewed.filter(r=>r.verdict==='pass').length,
      coverage:complete.length?reviewed.length/complete.length:null,
      passRateAmongReviewed:reviewed.length?reviewed.filter(r=>r.verdict==='pass').length/reviewed.length:null},
    questionCoverage:coverage(expected,targets,'question'), requirementCoverage:coverage(expected,targets,'requirement'),
    duplicateTriggerRate:null, wrongSpeakerTriggerRate:null, acousticWordErrorRate:null, testPassRate:null, cost:null,
    note:'First text is not verified useful text. Cancelled/stale/failed requests remain in counts but not success latency distributions. No speech-end, audio-quality, cost, or code-test score is inferred.' }
}
