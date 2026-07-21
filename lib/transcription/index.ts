import type { TranscriptionProvider, TranscriptionConfig } from './types'
import { AssemblyAIProvider } from './assemblyai'
import { DeepgramProvider } from './deepgram'

export type ProviderMaker = { name: string; make: () => TranscriptionProvider }

// AssemblyAI primary; if its token mint fails (e.g. key not set) we fall back to Deepgram.
export const DEFAULT_MAKERS: ProviderMaker[] = [
  { name: 'AssemblyAI', make: () => new AssemblyAIProvider() },
  { name: 'Deepgram', make: () => new DeepgramProvider() },
]

// Names the picker offers. 'auto' keeps the smart-fallback order.
export type ProviderChoice = 'auto' | 'AssemblyAI' | 'Deepgram'

export async function connectWithFallback(
  config: TranscriptionConfig,
  makers: ProviderMaker[] = DEFAULT_MAKERS,
  preferred: ProviderChoice = 'auto',
): Promise<{ provider: TranscriptionProvider; name: string }> {
  // Pin the chosen provider first; the rest stay as fallbacks so a bad key still recovers.
  const ordered =
    preferred === 'auto'
      ? makers
      : [...makers].sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))
  let lastErr: unknown
  for (const m of ordered) {
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
