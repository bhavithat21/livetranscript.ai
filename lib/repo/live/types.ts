import type { ScreenObservation, ScreenSnapshot } from '../screenEvidence'

export type Phase = 'understand' | 'explore' | 'plan' | 'implement' | 'debug' | 'review'
export type Lane = 'say' | 'plan' | 'review'
export type GuidanceStatus = 'proposed' | 'matched' | 'different' | 'not-visible' | 'stale'
export type Navigation = { path: string; line: number | null; symbol: string; reason: string; status: 'pending' | 'observed'; requestedAt: number }
export type EditSuggestion = { id: string; path: string; before: string; after: string; reason: string; line: number; fileRevision: number; status: GuidanceStatus; note: string }
export type CodePlan = {
  summary: string
  navigation: { path: string; line: number | null; symbol: string; reason: string } | null
  edits: Array<{ path: string; before: string; after: string; reason: string }>
  checks: Array<{ severity: 'blocking' | 'important' | 'optional'; text: string }>
  verify: string[]
  missingEvidence: string[]
}
export type RunEvidence = { id: string; command: string; codeRevision: number; startedAt: number; initialTerminal: string; status: 'waiting' | 'observed-pass' | 'observed-fail' | 'stale'; output: string; passed: number | null; failed: number | null }
export type Stamp = { sessionId: string; questionId: string; evidenceRevision: number; codeRevision: number }
export type RepoEvent = {
  schema: 1; sessionId: string; seq: number; at: number
} & (
  | { kind: 'observation'; data: { observation: ScreenObservation; origin: 'screen' | 'file-import' | 'fixture'; activePath: string | null } }
  | { kind: 'question'; data: { id: string; raw: string } }
  | { kind: 'utterance'; data: { text: string; speaker: 'interviewer' | 'candidate' } }
  | { kind: 'plan'; data: { stamp: Stamp; plan: CodePlan; model: string; elapsedMs: number } }
  | { kind: 'say'; data: { stamp: Stamp; text: string; model: string; firstTokenMs: number | null; elapsedMs: number } }
  | { kind: 'test-start'; data: { command: string } }
  | { kind: 'feedback'; data: { target: string; verdict: 'pass' | 'needs-work'; note: string } }
  | { kind: 'pause'; data: { paused: boolean } }
)
export type EventData = RepoEvent extends infer T ? T extends RepoEvent ? Pick<T, 'kind' | 'data'> : never : never
export type RepoSession = {
  schema: 1; id: string; seq: number; startedAt: number; paused: boolean
  snapshot: ScreenSnapshot; evidenceRevision: number; codeRevision: number; activePath: string | null
  question: { id: string; raw: string; text: string; at: number } | null
  phase: Phase; holdImplementation: boolean; constraints: string[]
  navigation: Navigation | null; edits: EditSuggestion[]; plan: CodePlan | null
  say: { text: string; model: string; firstTokenMs: number | null; elapsedMs: number } | null
  testRuns: RunEvidence[]
  feedback: Array<{ target: string; verdict: 'pass' | 'needs-work'; note: string; at: number }>
  events: RepoEvent[]; journalTruncated: boolean; discardedResults: number
}
