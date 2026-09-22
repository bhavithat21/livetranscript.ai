'use client'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'
import { EMPTY_TUNING, parseTuning, publishTuning, rollbackTuning, tuningKey, type CopilotObservation, type TuningState } from './tuning'

export type Calibration = {
  instructions: string; revision: number
  onResult?: (result: CopilotObservation) => void
  onRunning?: (running: boolean) => void
}
export const CopilotCalibrationContext = createContext<Calibration | null>(null)
type Controls = { state: TuningState; publish: (instructions: string) => void; rollback: () => void; error: string | null }
const TuningControls = createContext<Controls | null>(null)

/** Account/device-local profile. Mock overrides only the calibration context;
 * publishing changes the parent profile consumed by Live on its next request. */
export function InterviewTuningProvider({ ownerId, children }: { ownerId: string; children: ReactNode }) {
  const stored = useStoredPreference(tuningKey(ownerId), EMPTY_TUNING, parseTuning)
  const [error, setError] = useState<string | null>(null)
  const calibration = useMemo(() => ({ instructions: stored.value.active.instructions, revision: stored.value.active.revision }), [stored.value.active])
  const controls: Controls = {
    state: stored.value, error,
    publish(instructions) {
      const saved = stored.setValue((current) => publishTuning(current, instructions, Date.now()))
      setError(saved ? null : 'Profile applied in memory, but browser storage failed. It may be lost on reload; export your tuning report.')
    },
    rollback() {
      const saved = stored.setValue((current) => rollbackTuning(current, Date.now()))
      setError(saved ? null : 'Rollback applied in memory but could not be saved to this browser.')
    },
  }
  return <TuningControls.Provider value={controls}><CopilotCalibrationContext.Provider value={calibration}>{children}</CopilotCalibrationContext.Provider></TuningControls.Provider>
}
export function useInterviewTuning(): Controls {
  const controls = useContext(TuningControls)
  if (!controls) throw new Error('Interview tuning requires an account-scoped provider')
  return controls
}
