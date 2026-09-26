'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'
import { EMPTY_LEARNING, parseLearning, promote, rollback, type Comparison, type LearningState, type LessonId } from './policy'

type Controls = { state: LearningState; apply: (baseline: LessonId[], candidate: LessonId[], rows: Comparison[]) => boolean; rollback: () => boolean }
const Context=createContext<Controls|null>(null)
export function LearningProvider({ownerId,children}:{ownerId:string;children:ReactNode}) {
  const stored=useStoredPreference(`lt.coach.lessons.v1.${encodeURIComponent(ownerId)}`,EMPTY_LEARNING,parseLearning)
  return <Context.Provider value={{state:stored.value,apply(baseline,candidate,rows){
    return stored.setValue(current=>{
      if(JSON.stringify(current.active)!==JSON.stringify(baseline)) throw new Error('Active policy changed during evaluation; rerun before activation.')
      return promote(current,candidate,rows,Date.now())
    })
  },rollback(){return stored.setValue(current=>rollback(current,Date.now()))}}}>{children}</Context.Provider>
}
export const useLessonPolicy=()=>useContext(Context)
