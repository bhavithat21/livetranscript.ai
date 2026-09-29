import type { DiagnosticEvent } from '../diagnostics/schema'
export function mockReadiness(events: readonly DiagnosticEvent[], since: number) {
  const current = events.filter(event => event.at >= since)
  const has = (stage: string, event: string, channel?: string) => current.some(item => item.stage === stage && item.event === event && (!channel || item.attrs.channel === channel))
  const recovered = current.some(item => item.stage === 'transcription' && item.event === 'retry' && current.some(next => next.operationId === item.operationId && next.event === 'first_final' && next.at > item.at))
  const checks = [
    { label: 'Microphone PCM received', passed: has('audio', 'first_frame', 'mic') },
    { label: 'Call/system PCM received', passed: has('audio', 'first_frame', 'system') },
    { label: 'Finalized microphone speech received', passed: has('transcription', 'first_final', 'mic') },
    { label: 'Finalized call speech received', passed: has('transcription', 'first_final', 'system') },
    { label: 'Screenshot safely analyzed', passed: has('screen_model', 'success') },
    { label: 'Spoken or code guidance completed', passed: has('talk', 'success') || has('guide', 'success') },
    { label: 'Speech received after ASR recovery', passed: recovered },
  ]
  return { checks, passed: checks.every(check => check.passed) }
}
