'use client'
import { useCallback, useState } from 'react'
import { RepositoryCoach } from '@/components/coach/RepositoryCoach'
import type { InterviewSession } from '@/lib/interview/session'
import { MockInterview as PromptMockInterview } from './PromptMockInterview'

type MockProps = { blocked: boolean; visible?: boolean; onActivity: (active: boolean) => void; onComplete: (session: InterviewSession) => void }
export function MockInterview(props: MockProps) {
  const [target, setTarget] = useState<'answers' | 'repository'>('answers')
  const [active, setActive] = useState(false)
  const parentActivity = props.onActivity
  const activity = useCallback((value: boolean) => { setActive(value); parentActivity(value) }, [parentActivity])
  return <div>
    <div role="group" aria-label="Mock testing target" className="mb-5 flex flex-wrap gap-2">
      <button type="button" className="btn-ghost text-sm" aria-pressed={target === 'answers'} disabled={active} onClick={() => setTarget('answers')}>Answer prompts</button>
      <button type="button" className="btn-ghost text-sm" aria-pressed={target === 'repository'} disabled={active || props.blocked} onClick={() => setTarget('repository')}>Repository replay</button>
    </div>
    {target === 'repository' ? props.blocked ? <p role="status">End the live interview before starting repository replay.</p> : <RepositoryCoach onActivity={activity} /> : <PromptMockInterview {...props} onActivity={activity} />}
  </div>
}
