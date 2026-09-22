// Shared protocol only. Keep provider SDKs and server configuration out of clients.
export type RepoTask = 'plan' | 'debug' | 'review' | 'debrief'
export type RepoAgentRole = 'requirements' | 'implementation' | 'debugger' | 'reviewer' | 'synthesis'
export type RepoAgentInput = { question: string; context: string; transcript: string; task: RepoTask }
export type RepoAgentEvent =
  | { type: 'agent'; role: RepoAgentRole; model: string; status: 'running' | 'done' | 'failed'; text?: string; elapsedMs?: number }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string }
