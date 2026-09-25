/** Evidence-driven assistance for practice and explicitly AI-permitted sessions.
 * Scores reported by an extraction model are NOT calibrated correctness probabilities.
 * No type in this module grants filesystem, shell, browser-automation or remote-control access.
 */
export type Phase = 'understand' | 'explore' | 'plan' | 'implement' | 'debug' | 'review'
export type Permission = 'practice' | 'external-ai-allowed'
export type Lane = 'talk' | 'guide' | 'review'
export type Origin = 'screen' | 'file-import' | 'replay'
export type EvidenceRef = { sourceId: string; path: string; fileVersion: number; startLine: number | null; endLine: number | null }
export type FileObservation = { path: string; language: string; startLine: number | null; lines: string[]; confidence: number; endOfFile: boolean }
export type Observation = { files: FileObservation[]; visiblePaths: string[]; terminal: string; requirements: string[] }
export type Fragment = FileObservation & { sources: string[] }
export type ObservedFile = {
  path: string; language: string; version: number; fragments: Fragment[]
  retired: Array<{ version: number; sources: string[]; reason: string }>
  contentKey: string; lastSeen: number
}
export type Source = { id: string; at: number; origin: Origin; sequence: number }
export type Navigation = { path: string; startLine: number | null; endLine: number | null; symbol: string; reason: string; status: 'pending' | 'seen'; requestedAfter: number }
export type Patch = { id: string; path: string; fileVersion: number; startLine: number; before: string; after: string; reason: string; evidence: EvidenceRef[] }
export type PatchReview = { patchId: string; status: 'not-observed' | 'matches-proposal' | 'differs' | 'incomplete' | 'reverted'; detail: string; observedSource: string | null }
export type Finding = { severity: 'blocking' | 'review' | 'optional'; category: 'correctness' | 'scope' | 'security' | 'tests' | 'readability'; text: string; evidence: EvidenceRef[] }
export type TestEvidence = {
  id: string; codeVersion: number | null; startedAfter: number | null; startedAt: number | null; command: string
  status: 'awaiting-output' | 'running' | 'observed-pass' | 'observed-fail' | 'incomplete' | 'stale'
  passed: number | null; failed: number | null; sourceId: string | null; output: string; outputBefore: string
}
export type Question = { id: string; original: string; text: string; at: number }
export type Guidance = {
  summary: string
  look: Array<Omit<Navigation, 'status' | 'requestedAfter'>>
  patches: Patch[]; findings: Finding[]
  verify: Array<{ command: string; scope: string; reason: string }>
  hypotheses: Array<{ explanation: string; evidence: EvidenceRef[] }>
}
export type ResultRecord = {
  id: string; lane: Lane; questionId: string; evidenceVersion: number; codeVersion: number; taskVersion: number; contextKey: string
  status: 'running' | 'complete' | 'failed' | 'cancelled' | 'stale'
  text: string; guidance: Guidance | null; model: string; startedAt: number
  firstUsefulMs: number | null; totalMs: number | null; error: string | null
}
export type Feedback = { id: string; resultId: string; verdict: 'pass' | 'needs-work'; categories: string[]; note: string; at: number }
export type Task = { objective: string; requirements: string[]; constraints: string[]; phase: Phase; implementation: 'hold' | 'allowed'; version: number }
export type CoachState = {
  schema: 1; sessionId: string; permission: Permission | null; status: 'idle' | 'running' | 'paused' | 'ended'
  task: Task; evidenceVersion: number; codeVersion: number; sequence: number
  files: ObservedFile[]; knownPaths: string[]; sources: Source[]; lastScreen: { sourceId: string; observation: Observation } | null
  question: Question | null; questions: Question[]; navigation: Navigation | null
  patches: Patch[]; patchReviews: PatchReview[]; tests: TestEvidence[]
  results: ResultRecord[]; feedback: Feedback[]; seenEvents: string[]; warning: string | null
}
export type EventPayload =
  | { type: 'session.start'; permission: Permission; objective: string }
  | { type: 'session.pause' | 'session.resume' | 'session.end' }
  | { type: 'task.update'; objective: string; constraints: string[] }
  | { type: 'speech.final'; speaker: 'interviewer' | 'candidate'; text: string }
  | { type: 'question.new'; original: string; text: string }
  | { type: 'screen.observed'; origin: Origin; observation: Observation; capturedAt?: number }
  | { type: 'test.start'; command: string }
  | { type: 'result.start'; lane: Lane; requestId: string; questionId: string; evidenceVersion: number; contextKey: string }
  | { type: 'result.delta'; requestId: string; text: string; model: string }
  | { type: 'result.complete'; requestId: string; model: string; guidance: Guidance | null }
  | { type: 'result.fail'; requestId: string; error: string; cancelled: boolean }
  | { type: 'feedback.add'; resultId: string; verdict: 'pass' | 'needs-work'; categories: string[]; note: string }
export type CoachEvent = EventPayload & { id: string; at: number; sessionId: string }
export type ContextPacket = {
  schema: 1; sessionId: string; permission: Permission; question: Question; task: Task
  evidenceVersion: number; codeVersion: number; contextKey: string
  files: Array<{ path: string; language: string; fileVersion: number; complete: boolean; fragments: Fragment[] }>
  knownPaths: string[]; relations: Array<{ from: string; to: string; kind: 'lexical-reference'; evidence: EvidenceRef[] }>
  tests: TestEvidence[]; patches: Patch[]; patchReviews: PatchReview[]
  budget: { maxCharacters: number; usedCharacters: number; omittedPaths: string[] }
}
