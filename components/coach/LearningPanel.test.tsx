// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LearningPanel } from './LearningPanel'
import { EMPTY_LEARNING, SUITE, policyKey } from '@/lib/coach/learning/policy'
import { emptyCoach } from '@/lib/coach/state'
import type { CoachController } from '@/lib/coach/controller'
const mocks=vi.hoisted(()=>({apply:vi.fn(()=>true),rollback:vi.fn(()=>true)}))
vi.mock('@/lib/coach/learning/LearningContext',()=>({useLessonPolicy:()=>({state:EMPTY_LEARNING,...mocks})}))
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks()})
it('a passed model comparison cannot auto-activate: explicit post-rehearsal evidence and approval are required',async()=>{
  const state={...emptyCoach('approval-test'),status:'paused' as const,feedback:[{id:'f',resultId:'r',verdict:'needs-work' as const,categories:['directness'],note:'Too long',at:1}]}
  const controller={getSnapshot:()=>state} as CoachController
  const fetcher=vi.fn(async(_url:unknown,init:RequestInit)=>{
    const body=JSON.parse(String(init.body))
    return Response.json(body.action==='propose'?{candidate:['answer-first']}:{comparison:{suite:SUITE,caseId:body.caseId,repetition:body.repetition,baselineKey:policyKey([]),candidateKey:policyKey(['answer-first']),model:'unit-generator',judge:'unit-independent-judge',baselineScore:3,candidateScore:3.5,candidateGrounded:true,hardPass:true,baselineMs:100,candidateMs:110,note:'Scripted unit-test comparison, not real evaluation.'}})
  })
  vi.stubGlobal('fetch',fetcher)
  const view=render(<LearningPanel controller={controller} state={state}/>);view.container.querySelector('details')!.open=true
  fireEvent.click(screen.getByRole('button',{name:'Learn from feedback'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Approve evaluated candidate after rehearsal'})).toBeDefined())
  expect(fetcher).toHaveBeenCalledTimes(13);expect(mocks.apply).not.toHaveBeenCalled()
  const approve=screen.getByRole('button',{name:'Approve evaluated candidate after rehearsal'}) as HTMLButtonElement
  expect(approve.disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/I reviewed this exact candidate/))
  expect(approve.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Rehearsal report identifier and evidence'),{target:{value:'unit-report: independently reviewed. Fixture only.'}})
  expect(approve.disabled).toBe(false);fireEvent.click(approve)
  expect(mocks.apply).toHaveBeenCalledTimes(1)
  expect(mocks.apply.mock.calls[0]?.length).toBe(4)
})
