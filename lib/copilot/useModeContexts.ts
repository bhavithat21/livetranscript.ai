'use client'
import { useModeContext } from './useModeContext'

// Subscribe before routing so the first request after a mode change uses that
// mode's documents and story bank, rather than the previously rendered mode.
export function useModeContexts() {
  const general = useModeContext('general')
  const coding = useModeContext('coding')
  const systemDesign = useModeContext('systemDesign')
  const behavioral = useModeContext('behavioral')
  const repoInterview = useModeContext('repoInterview')
  return { general, coding, systemDesign, behavioral, repoInterview }
}
