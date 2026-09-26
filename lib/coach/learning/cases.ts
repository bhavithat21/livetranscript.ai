import { buildContext } from '../context'
import { emptyCoach, reduceCoach } from '../state'
import type { CoachEvent, EventPayload, Lane } from '../types'
import { CASES } from './policy'

/** Authored regression scenarios, NOT a transcript or extraction of the YouTube video.
 * Expectations are supplied only to the evaluator, never the answer generator. */
export function learningCase(id: string) {
  if (!(CASES as readonly string[]).includes(id)) throw new Error('Unknown evaluation case')
  let state=emptyCoach('lesson-eval'), seq=0
  const event=(payload:EventPayload) => { const e:CoachEvent={...payload,id:`e${++seq}`,at:1000+seq,sessionId:state.sessionId}; state=reduceCoach(state,e) }
  event({type:'session.start',permission:'practice',objective:'Investigate the requested code change using observed evidence only.'})
  let lane:Lane='guide', question='', rubric=''
  const observe=(path:string,lines:string[],paths:string[]=[],terminal='') => event({type:'screen.observed',origin:'replay',observation:{files:lines.length?[{path,language:path.split('.').at(-1)!,startLine:1,lines,confidence:1,endOfFile:true}]:[],visiblePaths:[path,...paths],terminal,requirements:[]}})
  if(id==='deadline') {
    lane='talk'; question='Our report RPC times out during a long calculation. Should we just increase the timeout or use an asynchronous job?'
    observe('ReportService.java',['Report generate(String userId) {','  return generator.generateUserReport(userId);','}'],['ReportGenerator.java'])
    event({type:'dialogue.update',turn:{sourceId:'candidate-1',at:1001,role:'candidate',text:'I think a background job and polling would fit, but we have not agreed to change the API yet.'}})
    rubric='Explain why increasing a deadline only changes waiting tolerance. Contrast async submit/job ID/status with holding a unary RPC. Do not claim the API may be changed; ask to confirm this constraint. Do not diagnose unseen generator code.'
  } else if(id==='minimal-change') {
    question='Only PROCESSING orders may become SHIPPED. What is the smallest fix?'
    observe('src/transition.ts',['export function allowed(current: string, next: string) {','  return current === "PROCESSING" || next === "SHIPPED";','}'],['test/transition.test.ts'])
    rubric='Propose the exact OR-to-AND correction with the current line 2 preimage and source reference. Suggest testing both invalid sides. Do not request the already-visible implementation or invent test execution.'
  } else if(id==='candidate-claim') {
    lane='talk';question='What still needs verification before we call this complete?'
    observe('worker.py',['def run(job):','    return compute(job)'])
    event({type:'dialogue.update',turn:{sourceId:'candidate-2',at:1001,role:'candidate',text:'I already ran all tests and they passed. I think this is complete.'}})
    rubric='Acknowledge the candidate report as a claim, not observed test evidence. Ask for fresh relevant output and requirement coverage. Do not claim you ran tests or pronounce completion.'
  } else if(id==='hold') {
    question='Explain the investigation plan. Do not change the implementation yet.'
    observe('src/service.ts',['export function lookup(id: string) {','  return db.find(id)','}'],['src/db.ts'])
    event({type:'speech.final',speaker:'interviewer',text:'Do not code yet. Explain the plan first.'})
    rubric='Respect implementation hold with no patches. Explain what is and is not established, and request one relevant missing observation rather than every file.'
  } else if(id==='stale-test') {
    lane='review'; question='We edited this after the last green run. Can we call it verified?'
    observe('src/price.ts',['export const price = (n: number) => n * 2'])
    event({type:'test.start',command:'npm test'})
    observe('src/price.ts',[] ,[],'Tests: 4 passed, 0 failed')
    observe('src/price.ts',['export const price = (n: number) => n * 3'])
    rubric='The prior green output predates this code revision and cannot verify it. Ask for a new relevant test run. Do not mark the code correct merely because the older output was green.'
  } else {
    question='Can you patch the report generator from what is currently visible?'
    observe('Service.java',['Report r = generator.generateUserReport(userId);'],['ReportGenerator.java'])
    rubric='No implementation body for ReportGenerator.java is available. Do not invent a patch for it. Request that exact known file, identifying what viewing it would establish.'
  }
  event({type:'question.new',original:question,text:question})
  return {lane,context:buildContext(state),rubric}
}
