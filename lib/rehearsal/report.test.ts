// @vitest-environment node
import { expect, it } from 'vitest'
import { RehearsalReport } from './report'
import { emptyCoach } from '@/lib/coach/state'
it('cannot turn no evidence or a human pass into a readiness/accuracy claim',()=>{
  const report=new RehearsalReport();report.observe(emptyCoach('a'))
  const data=JSON.parse(report.export('source-sha','{"events":[]}',[{resultId:'invented',verdict:'pass',category:'correctness',note:'I say all pass'}]))
  expect(data.accuracy).toBeNull();expect(data.readiness).toBe('not-certified');expect(data.humanReview).toEqual([])
  expect(data.observed.completeAnswers).toBe(0);expect(data.observed.callFinals).toBe(0)
})
it('records actual arrival counts independently of human review and report instances',()=>{
  const report=new RehearsalReport();report.observeAudio({at:1,callFinals:3,micFinals:2,callPhase:'recording',micPhase:'recording',interviewerAssigned:true,error:false})
  expect(JSON.parse(report.export('sha','{"events":[]}',[])).observed.callFinals).toBe(3)
  expect(JSON.parse(new RehearsalReport().export('sha','{"events":[]}',[])).observed.callFinals).toBe(0)
})
it('archives metadata, full final transcript and results without promoting a policy',()=>{
 const report=new RehearsalReport([],{title:'Video rehearsal',kind:'video-replay',sourceUrl:'https://www.youtube.com/watch?v=ZE_YEn-okfk',split:'holdout',playbackRate:1,startSeconds:0,endSeconds:60})
 const state=emptyCoach('owned-session');report.observe(state);report.finishTranscript('Final trailing words that arrived at End')
 const data=JSON.parse(report.export('sha','{"events":[],"truncated":false}',[]))
 expect(data.sessionId).toBe('owned-session');expect(data.metadata.split).toBe('holdout');expect(data.finalTranscript).toContain('trailing words');expect(data.benchmarks.acousticWordErrorRate).toBeNull()
})
it('retains dialogue beyond the current controller window and marks replay truncation',()=>{
 const report=new RehearsalReport(),state=emptyCoach('s')
 report.observe({...state,conversation:[{sourceId:'first',role:'interviewer',text:'First words',at:1}]})
 report.observe({...state,conversation:[{sourceId:'last',role:'candidate',text:'Last words',at:2}]})
 const data=JSON.parse(report.export('sha','{"events":[],"truncated":true}',[]))
 expect(data.conversation).toHaveLength(2);expect(data.truncated).toBe(true)
})
