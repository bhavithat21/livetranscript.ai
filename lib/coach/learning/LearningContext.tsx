'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'
import { EMPTY_LEARNING, parseLearning, promote, rollback, type Comparison, type LearningState, type LessonId } from './policy'

type Controls = { state: LearningState; apply: (baseline: LessonId[], candidate: LessonId[], rows: Comparison[], approval: { acknowledged: true; evidence: string }) => boolean; rollback: () => boolean }
const Context=createContext<Controls|null>(null)
export function LearningProvider({ownerId,children}:{ownerId:string;children:ReactNode}) {
  const stored=useStoredPreference(`lt.coach.lessons.v1.${encodeURIComponent(ownerId)}`,EMPTY_LEARNING,parseLearning)
  return <Context.Provider value={{state:stored.value,apply(baseline,candidate,rows,approval){
    if(approval?.acknowledged !== true || approval.evidence.trim().length < 15) return false
    return stored.setValue(current=>{
      if(JSON.stringify(current.active)!==JSON.stringify(baseline)) throw new Error('Active policy changed during evaluation; rerun before activation.')
      const next = promote(current,candidate,rows,Date.now())
      const last = next.history.at(-1)
      if(last?.action === 'promoted') last.reason = `${last.reason} Human rehearsal attestation (not machine verified): ${approval.evidence.trim().slice(0,650)}`
      return next
    })
  },rollback(){return stored.setValue(current=>rollback(current,Date.now()))}}}>{children}</Context.Provider>
}
export const useLessonPolicy=()=>useContext(Context)
