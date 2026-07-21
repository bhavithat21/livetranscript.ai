import { describe, it, expect, vi } from 'vitest'
import { connectWithFallback } from './index'
import type { TranscriptionProvider } from './types'

const stub = (fail: boolean): TranscriptionProvider => ({
  connect: fail ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn().mockResolvedValue(undefined),
  sendAudio: vi.fn(),
  updateKeyterms: vi.fn(),
  onPartial: vi.fn(),
  onFinal: vi.fn(),
  disconnect: vi.fn(),
})
const cfg = { keyterms: [], sampleRate: 16000, maxSpeakers: 5 }

describe('connectWithFallback', () => {
  it('returns the first provider that connects', async () => {
    const res = await connectWithFallback(cfg, [
      { name: 'primary', make: () => stub(true) },
      { name: 'fallback', make: () => stub(false) },
    ])
    expect(res.name).toBe('fallback')
  })
  it('throws when all providers fail', async () => {
    await expect(
      connectWithFallback(cfg, [{ name: 'only', make: () => stub(true) }]),
    ).rejects.toThrow()
  })
  it('pins the preferred provider first', async () => {
    const makers = [
      { name: 'AssemblyAI', make: () => stub(false) },
      { name: 'Deepgram', make: () => stub(false) },
    ]
    const res = await connectWithFallback(cfg, makers, 'Deepgram')
    expect(res.name).toBe('Deepgram')
  })
  it('falls back past a failing preferred provider', async () => {
    const makers = [
      { name: 'AssemblyAI', make: () => stub(false) },
      { name: 'Deepgram', make: () => stub(true) },
    ]
    // Deepgram preferred but fails → recovers to AssemblyAI.
    const res = await connectWithFallback(cfg, makers, 'Deepgram')
    expect(res.name).toBe('AssemblyAI')
  })
})
