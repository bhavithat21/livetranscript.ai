import type { CoachState, ResultRecord } from '@/lib/coach/types'
import { lessonIds, policyKey, type LessonId } from '@/lib/coach/learning/policy'
import { redactSecrets } from '@/lib/coach/validation'

export type HumanReview = { resultId: string; verdict: 'pass' | 'needs-work'; category: string; note: string }
export type AudioEvidence = { at: number; callFinals: number; micFinals: number; callPhase: string; micPhase: string; interviewerAssigned: boolean; error: boolean }
/** Captures client observations, not an attestation of provider authenticity or
 * code execution. Expected answers/reviewer notes never enter generation. */
export class RehearsalReport {
  private results = new Map<string, ResultRecord>()
  private audio: AudioEvidence[] = []
  private sources = 0
  private started = Date.now()
  private lessons: LessonId[]
  constructor(lessons: LessonId[] = []) { this.lessons = lessonIds(lessons) }
  observe(state: CoachState) {
    for (const record of state.results) this.results.set(record.id, { ...record })
    this.sources = Math.max(this.sources, state.sources.filter(s => s.origin === 'screen').length)
  }
  observeAudio(e: AudioEvidence) { this.audio.push(e); if(this.audio.length > 7200) this.audio.shift() }
  getResults() { return [...this.results.values()] }
  export(commit: string, replay: string, reviews: HumanReview[]) {
    const records = [...this.results.values()]
    const latest = new Map(reviews.map(r => [r.resultId,r]))
    const generated = records.filter(r => r.status === 'complete')
    const reviewed = generated.filter(r => latest.has(r.id))
    const actual = records.filter(r=>r.model && !/fixture|simulat|synthetic|mock/i.test(r.model))
    const notes = [...latest.values()].filter(r => records.some(record => record.id === r.resultId))
    const max = (key: 'callFinals'|'micFinals') => Math.max(0,...this.audio.map(e=>e[key]))
    return JSON.stringify({ format:'livetranscript-interactive-rehearsal-v1', commit, startedAt:this.started, exportedAt:Date.now(),
      kind:'interactive-client-observations', lessonPolicy: { ids:this.lessons, key:policyKey(this.lessons), frozenPerSession:true }, accuracy:null, readiness:'not-certified',
      observed:{callFinals:max('callFinals'),micFinals:max('micFinals'),interviewerAssigned:this.audio.some(e=>e.interviewerAssigned),screenObservations:this.sources,returnedModelResponses:actual.length,completeAnswers:generated.length,reviewedAnswers:reviewed.length},
      limitations:['Client telemetry is not independent verification.','Accuracy requires independently annotated questions, requirements and code tests.','firstUsefulMs is request-to-first-text, NOT speech-end-to-useful-answer.','Cancelled/stale responses and missing speech remain part of the review.','No model-policy promotion follows this export.'],
      audio:this.audio, results:records, humanReview:notes, replay:JSON.parse(replay)
    },(_k,v)=>typeof v==='string'?redactSecrets(v):v,2)
  }
}
