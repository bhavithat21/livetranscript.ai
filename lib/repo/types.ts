export type RepoSourceFile = {
  path: string
  content: string
  language: string
  symbols: string[]
}

export type RepoMatch = {
  path: string
  language: string
  symbols: string[]
  score: number
  reason: string
  excerpt: string
}

export type RepoIndex = {
  name: string
  files: RepoSourceFile[]
  indexedAt: number
  totalChars: number
}

export type QuestionStatus = 'captured' | 'answering' | 'answered' | 'failed'

export type InterviewQuestion = {
  id: string
  text: string
  normalized: string
  capturedAt: number
  /** Last text revision; used to wait until streaming ASR has settled. */
  updatedAt?: number
  status: QuestionStatus
  /** Transcript character offset: distinguishes repeated questions from ASR revisions. */
  sourceStart?: number
  /** Stable question position when earlier ASR text changes length. */
  sourceOrder?: number
}
