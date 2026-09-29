export type TranscriptPart = { text: string; speaker: number | null; startMs: number; endMs: number }

export type TranscriptEvent = {
  /** Stable within this provider connection; formatted finals replace the same turn. */
  utteranceId?: string
  confidence?: number
  parts?: TranscriptPart[]
  text: string
  isFinal: boolean
  speaker: number | null
  startMs: number
  endMs: number
}

export type TranscriptionConfig = {
  recognitionMode?: 'balanced' | 'careful'
  keyterms: string[]
  sampleRate: number
  maxSpeakers: number
  // Optional cancellation covers token minting, connection and the live socket.
  diagnosticHeaders?: Record<string, string>
  signal?: AbortSignal
}

export type TranscriptionStatus = { error: string; retryable?: boolean; status?: number; closeCode?: number }

export interface TranscriptionProvider {
  connect(config: TranscriptionConfig): Promise<void>
  sendAudio(chunk: ArrayBuffer): void
  updateKeyterms(terms: string[]): Promise<void>
  onPartial(callback: (e: TranscriptEvent) => void): void
  onFinal(callback: (e: TranscriptEvent) => void): void
  // Fired when the socket drops AFTER a successful connect (not on graceful
  // disconnect). Lets the UI surface the failure and stop the "recording" illusion.
  onStatus?(callback: (status: TranscriptionStatus) => void): void
  disconnect(): Promise<void>
}
