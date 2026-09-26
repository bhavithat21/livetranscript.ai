'use client'
import { useCallback, useState } from 'react'
import { SimulationLab } from './SimulationLab'
import { VideoTest } from './VideoTest'
import { RepositoryCoach } from '@/components/coach/RepositoryCoach'
import type { InterviewSession } from '@/lib/interview/session'
import { MockInterview as PromptMockInterview } from './PromptMockInterview'

type MockProps = { blocked: boolean; visible?: boolean; onActivity: (active: boolean) => void; onComplete: (session: InterviewSession) => void }
export function MockInterview(props: MockProps) {
  const [target, setTarget] = useState<'answers' | 'repository' | 'video' | 'simulator'>('answers')
  const [active, setActive] = useState(false)
  const parentActivity = props.onActivity
  const activity = useCallback((value: boolean) => { setActive(value); parentActivity(value) }, [parentActivity])
  return <div>
    <p className="mb-3 text-sm"><a className="underline" href="/interview/rehearsal">Open the isolated interactive rehearsal</a> · Requires test configuration; no new sidebar item.</p>
    <div role="group" aria-label="Mock testing target" className="mb-5 flex flex-wrap gap-2">
      <button type="button" className="btn-ghost text-sm" aria-pressed={target === 'answers'} disabled={active} onClick={() => setTarget('answers')}>Answer prompts</button>
      <button type="button" className="btn-ghost text-sm" aria-pressed={target === 'repository'} disabled={active || props.blocked} onClick={() => setTarget('repository')}>Repository replay</button>
      <button type="button" className="btn-ghost text-sm" aria-pressed={target === 'video'} disabled={active || props.blocked} onClick={() => setTarget('video')}>Video test</button>
      <button type="button" className="btn-ghost text-sm" aria-pressed={target === 'simulator'} disabled={active || props.blocked} onClick={() => setTarget('simulator')}>Real-time simulator</button>
    </div>
    {target === 'simulator' ? <SimulationLab visible={props.visible} onActivity={activity} /> : target === 'video' ? <VideoTest {...props} visible={props.visible ?? true} onActivity={activity} /> : target === 'repository' ? props.blocked ? <p role="status">End the live interview before starting repository replay.</p> : <RepositoryCoach onActivity={activity} /> : <PromptMockInterview {...props} onActivity={activity} />}
  </div>
}
