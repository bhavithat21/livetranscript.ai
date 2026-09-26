import type { CoachState, DialogueTurn, Question, ResultRecord } from '@/lib/coach/types'
import { lessonIds, policyKey, type LessonId } from '@/lib/coach/learning/policy'
import { redactSecrets } from '@/lib/coach/validation'
import { calculateBenchmarks, DEFAULT_METADATA, type BenchmarkMetadata, type ExpectedEvent, type Target } from './metrics'

export type HumanReview = { resultId: string; verdict: 'pass' | 'needs-work'; category: string; note: string }
export type AudioEvidence = { at: number; callFinals: number; micFinals: number; callPhase: string; micPhase: string; interviewerAssigned: boolean; error: boolean }
/** Client evidence, not proof of provider authenticity, acoustic accuracy or test execution. */
export class RehearsalReport {
  private results = new Map<string, ResultRecord>()
  private questions = new Map<string, Question>()
  private dialogue = new Map<string, DialogueTurn>()
  private targets = new Map<string, Target>()
  private audio: AudioEvidence[] = []
  private warnings: Array<{at:number;text:string}> = []
  private truncated=false
  private sourceIds = new Set<string>()
  private started = Date.now()
  private ended:number|null=null
  private sessionId = crypto.randomUUID()
  private status='idle'
  private lastWarning:string|null=null
  private transcript=''
  private lessons: LessonId[]
  private metadata:BenchmarkMetadata
  constructor(lessons: LessonId[] = [], metadata:BenchmarkMetadata=DEFAULT_METADATA) { this.lessons = lessonIds(lessons);this.metadata={...metadata} }
  observe(state: CoachState) {
    this.sessionId=state.sessionId;this.status=state.status
    if(state.status==='ended'&&this.ended===null)this.ended=Date.now()
    for (const record of state.results) this.results.set(record.id, { ...record })
    for(const q of state.questions){this.questions.set(q.id,{...q});this.targets.set(q.id,{id:q.id,kind:'question',text:q.text})}
    for(const d of state.conversation??[])this.dialogue.set(d.sourceId,{...d})
    for(const r of state.task.spokenRequirements??[])this.targets.set(r.sourceId,{id:r.sourceId,kind:'requirement',text:r.text})
    for(const s of state.sources)if(s.origin==='screen'&&!this.sourceIds.has(s.id)){
      if(this.sourceIds.size<20000)this.sourceIds.add(s.id);else this.truncated=true
    }
    if(state.warning&&state.warning!==this.lastWarning)this.warnings.push({at:Date.now(),text:state.warning})
    this.lastWarning=state.warning
    if(this.dialogue.size>10000){this.dialogue.delete(this.dialogue.keys().next().value!);this.truncated=true}
    if(this.warnings.length>1000){this.warnings.shift();this.truncated=true}
  }
  finishTranscript(text:string){this.transcript=text.slice(0,500_000);if(text.length>500_000)this.truncated=true}
  observeAudio(e: AudioEvidence) { this.audio.push({...e}); if(this.audio.length > 7200){this.audio.shift();this.truncated=true} }
  getResults() { return [...this.results.values()] }
  getTargets() { return [...this.targets.values()] }
  getMetrics(reviews:HumanReview[]=[],expected:ExpectedEvent[]=[]) {return calculateBenchmarks(this.getResults(),[...this.questions.values()],reviews,expected,this.getTargets())}
  export(commit: string, replay: string, reviews: HumanReview[], expected:ExpectedEvent[]=[]) {
    const records = this.getResults()
    const latest = new Map(reviews.map(r => [r.resultId,r]))
    const generated = records.filter(r => r.status === 'complete')
    const reviewed = generated.filter(r => latest.has(r.id))
    const actual = records.filter(r=>r.model && !/fixture|simulat|synthetic|mock/i.test(r.model))
    const notes = [...latest.values()].filter(r => records.some(record => record.id === r.resultId))
    const max = (key: 'callFinals'|'micFinals') => this.audio.reduce((n,e)=>Math.max(n,e[key]),0)
    const replayValue=JSON.parse(replay)
    return JSON.stringify({ format:'livetranscript-interactive-rehearsal-v1', reportVersion:2,sessionId:this.sessionId,status:this.status,
      commit, startedAt:this.started,endedAt:this.ended,exportedAt:Date.now(),metadata:this.metadata,truncated:this.truncated||replayValue.truncated===true,
      kind:'interactive-client-observations', lessonPolicy: { ids:this.lessons, key:policyKey(this.lessons), frozenPerSession:true }, accuracy:null, readiness:'not-certified',
      observed:{callFinals:max('callFinals'),micFinals:max('micFinals'),interviewerAssigned:this.audio.some(e=>e.interviewerAssigned),screenObservations:this.sourceIds.size,returnedModelResponses:actual.length,completeAnswers:generated.length,reviewedAnswers:reviewed.length},
      benchmarks:this.getMetrics(notes,expected),expectedEvents:expected,targets:this.getTargets(),questions:[...this.questions.values()],conversation:[...this.dialogue.values()],finalTranscript:this.transcript,warnings:this.warnings,
      limitations:['Client telemetry and model-name filtering do not prove provider authenticity.','Accuracy needs independently annotated questions, requirements and code tests.','firstUsefulMs is request-to-first-text, NOT speech-end latency or verified usefulness.','Cancelled/stale responses, unreviewed answers and missing speech must not be excluded from review.','Video URL/range are user annotations, not synchronized player telemetry.','No policy promotion follows saving/export.','No raw audio or screenshot images. Secret redaction is best-effort; inspect before sharing.'],
      audio:this.audio, results:records, humanReview:notes, replay:replayValue
    },(_k,v)=>typeof v==='string'?redactSecrets(v):v,2)
  }
}
