import type { TranscriptionProvider, TranscriptionConfig } from './types'
import { AssemblyAIProvider } from './assemblyai'
import { DeepgramProvider } from './deepgram'

export type ProviderMaker = { name: string; make: () => TranscriptionProvider }

// AssemblyAI primary; if its token mint fails (e.g. key not set) we fall back to Deepgram.
export const DEFAULT_MAKERS: ProviderMaker[] = [
  { name: 'AssemblyAI', make: () => new AssemblyAIProvider() },
  { name: 'Deepgram', make: () => new DeepgramProvider() },
]

export async function connectWithFallback(
  config: TranscriptionConfig,
  makers: ProviderMaker[] = DEFAULT_MAKERS,
): Promise<{ provider: TranscriptionProvider; name: string }> {
  let lastErr: unknown
  for (const m of makers) {
    const provider = m.make()
    try {
      await provider.connect(config)
      return { provider, name: m.name }
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`All transcription providers failed: ${String(lastErr)}`)
}
