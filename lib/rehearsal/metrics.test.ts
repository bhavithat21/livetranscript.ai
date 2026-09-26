// @vitest-environment node
import {expect,it} from 'vitest'
import {calculateBenchmarks,coverage,distribution} from './metrics'
import type {ResultRecord} from '@/lib/coach/types'
const r=(patch:Partial<ResultRecord>={}):ResultRecord=>({id:'a',lane:'talk',questionId:'q',evidenceVersion:1,codeVersion:1,taskVersion:1,contextKey:'k',status:'complete',text:'An answer',guidance:null,model:'fixture',startedAt:1100,firstUsefulMs:100,totalMs:400,error:null,...patch})
it('never replaces missing measurements with zero or an accuracy/readiness score',()=>{
 const m=calculateBenchmarks([],[],[]);expect(m.lanes[0].firstText.p50Ms).toBeNull();expect(m.humanReview.passRateAmongReviewed).toBeNull();expect(m.questionCoverage.recall).toBeNull();expect(m.cost).toBeNull();expect(m.speechEndToFirstUsefulWords).toBeNull()
})
it('uses nearest-rank quantiles and explicitly marks small samples',()=>{
 expect(distribution([null,NaN,-1,400,100,200])).toEqual({samples:3,p50Ms:200,p95Ms:400,maxMs:400,smallSample:true})
 expect(distribution(Array.from({length:20},(_,i)=>i+1)).p95Ms).toBe(19)
})
it('counts every request but success latency excludes stale/cancelled/failed outputs',()=>{
 const m=calculateBenchmarks([r(),r({id:'b',status:'cancelled',firstUsefulMs:5}),r({id:'c',status:'stale',firstUsefulMs:1}),r({id:'d',status:'failed'})],[{id:'q',text:'Question',original:'Question',at:1000}],[])
 expect(m.requests).toBe(4);expect(m.cancelled).toBe(1);expect(m.stale).toBe(1);expect(m.failed).toBe(1);expect(m.lanes[0].firstText.samples).toBe(1);expect(m.questionDispatchToFirstText.p50Ms).toBe(200)
})
it('structured guide completion does not invent a first text measurement',()=>{
 const m=calculateBenchmarks([r({lane:'guide',text:'',firstUsefulMs:0})],[],[])
 expect(m.lanes[1].completion.p50Ms).toBe(400);expect(m.lanes[1].firstText.samples).toBe(0)
})
it('review coverage is separate from pass rate; unreviewed outputs cannot count as passes',()=>{
 const m=calculateBenchmarks([r(),r({id:'b'}),r({id:'c',status:'failed'})],[],[{resultId:'a',verdict:'pass',category:'correctness',note:''},{resultId:'c',verdict:'pass',category:'correctness',note:''},{resultId:'madeup',verdict:'pass',category:'correctness',note:''}])
 expect(m.humanReview).toEqual({completed:2,reviewed:1,passes:1,coverage:.5,passRateAmongReviewed:1})
})
it('manual expected event denominator includes misses but not invented/duplicate matches',()=>{
 const target=[{id:'q',kind:'question' as const,text:'actual'}]
 const e={id:'1',kind:'question' as const,text:'Expected',verdict:'detected' as const,matchedId:'q'}
 expect(coverage([e,{...e,id:'2',verdict:'missed'}],target,'question').recall).toBe(.5)
 expect(coverage([e,{...e,id:'2'}],target,'question').recall).toBeNull()
 expect(coverage([{...e,matchedId:'invented'}],target,'question').invalid).toBe(1)
 expect(coverage([{...e,verdict:'unreviewed'}],target,'question').recall).toBeNull()
})
