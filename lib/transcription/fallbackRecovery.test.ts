import { expect, it, vi } from 'vitest'
import { connectWithFallback } from './index'
import type { TranscriptionProvider } from './types'
function adapter(error: Error): TranscriptionProvider { return { connect: vi.fn(async () => { throw error }), disconnect: vi.fn(async () => {}), sendAudio() {}, updateKeyterms: async () => {}, onPartial() {}, onFinal() {} } }
const config = { sampleRate: 16000, maxSpeakers: 2, keyterms: [] }
it('keeps active-provider network recovery eligible when optional fallback is unconfigured', async () => {
  const primary = adapter(Object.assign(new Error('Network failure'), { retryable: true }))
  const secondary = adapter(Object.assign(new Error('Unavailable credentials'), { status: 503, retryable: false }))
  await expect(connectWithFallback(config, [{ name: 'Deepgram', make: () => primary }, { name: 'AssemblyAI', make: () => secondary }])).rejects.toMatchObject({ retryable: true })
  expect(primary.disconnect).toHaveBeenCalledOnce(); expect(secondary.disconnect).toHaveBeenCalledOnce()
})
it('does not retry when every provider has a permanent error', async () => {
  const first = adapter(Object.assign(new Error('Denied'), { status: 401, retryable: false }))
  const second = adapter(Object.assign(new Error('Unavailable credentials'), { status: 503, retryable: false }))
  await expect(connectWithFallback(config, [{ name: 'Deepgram', make: () => first }, { name: 'AssemblyAI', make: () => second }])).rejects.toMatchObject({ retryable: false })
})
