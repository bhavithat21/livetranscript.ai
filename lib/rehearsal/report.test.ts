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
