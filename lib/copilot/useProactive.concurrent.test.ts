import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProactive } from './useProactive'
beforeEach(()=>vi.useFakeTimers())
afterEach(()=>{cleanup();vi.useRealTimers()})
const tick=async(ms=600)=>{await act(async()=>vi.advanceTimersByTimeAsync(ms))}
describe('automatic question scheduling',()=>{
  it('continues detecting while a serial answer is pending and drains the newest extension once',async()=>{
    let text='What causes the timeout?', finish!:()=>void
    const answer=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve})).mockResolvedValue(undefined)
    renderHook(()=>useProactive(true,()=>text,answer))
    await tick();expect(answer).toHaveBeenCalledTimes(1)
    text+=' Candidate response. How would you implement background jobs?';await tick()
    text+=' What failure states should polling expose?';await tick();expect(answer).toHaveBeenCalledTimes(1)
    await act(async()=>finish());await tick();expect(answer).toHaveBeenCalledTimes(2)
    expect(answer.mock.calls[1][0]).toContain('background jobs');expect(answer.mock.calls[1][0]).toContain('failure states')
    await tick(60000);expect(answer).toHaveBeenCalledTimes(2)
  })
  it('dispatches a new question immediately after settling without waiting for an obsolete answer',async()=>{
    let text='What causes the timeout?'
    const answer=vi.fn(()=>new Promise<void>(()=>{}))
    renderHook(()=>useProactive(true,()=>text,answer,{latestWins:true}))
    await tick();text+=' Candidate response. How should we handle cancellation?';await tick()
    expect(answer).toHaveBeenCalledTimes(2)
  })
  it('does not re-answer static or punctuation-revised text across disable/enable cycles',async()=>{
    let text='What causes the timeout.';const answer=vi.fn(async()=>{})
    const view=renderHook(({enabled})=>useProactive(enabled,()=>text,answer),{initialProps:{enabled:true}})
    await tick();view.rerender({enabled:false});text='What causes the timeout?';view.rerender({enabled:true})
    await tick(30000);expect(answer).toHaveBeenCalledTimes(1)
  })
  it('contains a rejected callback, reports it, and never loops retries',async()=>{
    const answer=vi.fn(async()=>{throw new Error('Fixture failure')})
    const {result}=renderHook(()=>useProactive(true,()=> 'Explain retry backoff.',answer))
    await tick(60000);expect(answer).toHaveBeenCalledTimes(1);expect(result.current.error).toBe('Fixture failure')
  })
  it('waits for an evolving unpunctuated question and resets the settle deadline',async()=>{
    let text='How would you design';const answer=vi.fn(async()=>{})
    renderHook(()=>useProactive(true,()=>text,answer))
    await tick(3000);expect(answer).not.toHaveBeenCalled()
    text+=' the report';await tick(600);expect(answer).not.toHaveBeenCalled()
    text+=' queue';await tick(600);expect(answer).not.toHaveBeenCalled()
    await tick(600);expect(answer).toHaveBeenCalledTimes(1)
  })
  it('does not join a split voice turn into the next question',async()=>{
    let text='How would you design';const answer=vi.fn(async()=>{})
    const view=renderHook(()=>useProactive(true,()=>text,answer));await tick(1500)
    text+=' a report queue?';await tick();view.unmount();await tick(60000)
    expect(answer).toHaveBeenCalledTimes(1)
  })
})
