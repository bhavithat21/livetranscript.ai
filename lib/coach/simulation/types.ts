import type { CoachState, ContextPacket, Lane, Observation } from '../types'
export type SimAction =
  | { kind: 'speech'; id: string; text: string; channel: 'call' | 'mic'; speaker: number | null; final?: boolean }
  | { kind: 'screen'; observation: Observation; capturedAt?: number; importOnly?: boolean }
  | { kind: 'pause' | 'resume' | 'end' }
  | { kind: 'test'; command: string }
  | { kind: 'retry'; lane: Lane }
  | { kind: 'interviewer'; speaker: number }
export type SimEvent = { at: number; label: string; action: SimAction }
export type Fault = { lane: Lane; occurrence: number; behavior: 'slow' | 'hang' | 'fail' | 'unsupported-patch'; delayMs?: number; ignoreAbort?: boolean }
export type SimRequest = { at: number; lane: Lane; question: string; status: 'pending' | 'complete' | 'failed' | 'aborted'; completedAt?: number; context: ContextPacket }
export type SimCheck = { id: string; label: string; passed: boolean; expected: string; actual: string }
export type SimState = { time: number; events: number; state: CoachState; requests: SimRequest[]; transportErrors: string[] }
export type Scenario = { id: string; name: string; description: string; duration: number; objective: string; events: SimEvent[]; faults?: Fault[]; check: (state: SimState) => SimCheck[] }
export type SimReport = { format: 'livetranscript-simulator-v1'; scenarioId: string; seed: number; kind: 'synthetic-runtime-test'; realAudio: false; realVision: false; providerInference: false; simulatedMs: number; events: number; requests: number; activeRequests: number; checks: SimCheck[]; passed: boolean; failures: string[] }
