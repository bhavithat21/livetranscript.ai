import { afterEach, expect, it, vi } from 'vitest'
import { RecoveringTranscription, recoveryDrainSpeed, type RecoveryEvent } from './recovery'
import type { TranscriptionProvider, TranscriptionStatus } from './types'
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('uses conservative real-time pacing except for documented Deepgram recovery', () => {
  expect(recoveryDrainSpeed('Deepgram')).toBe(1.25)
  expect(recoveryDrainSpeed('AssemblyAI')).toBe(1)
  expect(recoveryDrainSpeed('unknown')).toBe(1)
})
it('does not drain AssemblyAI audio faster than real time', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(.5)
  let fail: (value: TranscriptionStatus) => void = () => {}
  const raw = (): TranscriptionProvider => ({ connect: async () => {}, sendAudio: vi.fn(), updateKeyterms: async () => {}, onPartial() {}, onFinal() {}, onStatus(cb) { fail = cb }, disconnect: async () => {} })
  const first = raw(), second = raw()
  const wrapper = new RecoveringTranscription({ name: 'AssemblyAI', provider: first }, { sampleRate: 16000, maxSpeakers: 2, keyterms: [] }, async () => ({ name: 'AssemblyAI', provider: second }))
  fail({ error: 'Connection lost' })
  for (let i = 0; i < 3; i++) wrapper.sendAudio(new ArrayBuffer(3200))
  await vi.advanceTimersByTimeAsync(500)
  expect(second.sendAudio).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(99)
  expect(second.sendAudio).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(second.sendAudio).toHaveBeenCalledTimes(2)
  await wrapper.disconnect()
})
it('reports queued audio discarded when recovery cannot complete', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(.5)
  let fail: (value: TranscriptionStatus) => void = () => {}
  const provider: TranscriptionProvider = { connect: async () => {}, sendAudio() {}, updateKeyterms: async () => {}, onPartial() {}, onFinal() {}, onStatus(cb) { fail = cb }, disconnect: async () => {} }
  const events: RecoveryEvent[] = []
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider }, { sampleRate: 16000, maxSpeakers: 2, keyterms: [] }, async () => { throw new Error('Network unavailable') }, event => events.push(event))
  fail({ error: 'Connection lost' }); wrapper.sendAudio(new ArrayBuffer(3200))
  await vi.advanceTimersByTimeAsync(4000)
  expect(events.reduce((sum, event) => sum + (event.droppedMs ?? 0), 0)).toBe(100)
  await wrapper.disconnect()
})
