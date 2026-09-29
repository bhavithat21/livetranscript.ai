import type { TranscriptionProvider, TranscriptionConfig } from './types'
import { AssemblyAIProvider } from './assemblyai'
import { DeepgramProvider } from './deepgram'
import { retryableTranscriptionFailure } from './recovery'
import { readRecognitionMode } from './recognition'

export type ProviderMaker = { name: string; make: () => TranscriptionProvider }
export const DEFAULT_MAKERS: ProviderMaker[] = [
  { name: 'Deepgram', make: () => new DeepgramProvider() },
  { name: 'AssemblyAI', make: () => new AssemblyAIProvider() },
]
export type ProviderChoice = 'auto' | 'AssemblyAI' | 'Deepgram'

export async function connectWithFallback(config: TranscriptionConfig, makers: ProviderMaker[] = DEFAULT_MAKERS, preferred: ProviderChoice = 'auto'): Promise<{ provider: TranscriptionProvider; name: string }> {
  const ordered = preferred === 'auto' ? makers : [...makers].sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))
  let lastErr: unknown, transientErr: unknown
  for (const m of ordered) {
    config.signal?.throwIfAborted()
    const provider = m.make()
    try {
      await provider.connect({ ...config, recognitionMode: config.recognitionMode ?? readRecognitionMode() })
      config.signal?.throwIfAborted()
      return { provider, name: m.name }
    } catch (error) {
      try { await provider.disconnect() } catch { /* continue after cleanup failure */ }
      config.signal?.throwIfAborted()
      lastErr = error
      // An unconfigured optional fallback must not erase an earlier recoverable
      // outage of the active provider. The wrapper still enforces all budgets.
      if (retryableTranscriptionFailure(error)) transientErr = error
    }
  }
  const selected = transientErr ?? lastErr
  const failure = selected as { status?: number; retryable?: boolean } | undefined
  throw Object.assign(new Error('All transcription providers failed to connect'), { status: failure?.status, retryable: failure?.retryable ?? retryableTranscriptionFailure(selected) })
}
