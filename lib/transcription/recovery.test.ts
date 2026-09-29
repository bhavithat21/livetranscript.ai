import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecoveringTranscription, retryableTranscriptionFailure, type RecoveryEvent } from './recovery'
import type { TranscriptEvent, TranscriptionProvider, TranscriptionStatus } from './types'
function engine() {
  let partial: (e: TranscriptEvent) => void = () => {}, final = partial
  let status: (e: TranscriptionStatus) => void = () => {}
  const provider: TranscriptionProvider = {
    connect: vi.fn(async () => {}), sendAudio: vi.fn(), updateKeyterms: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    onPartial: cb => { partial = cb }, onFinal: cb => { final = cb }, onStatus: cb => { status = cb },
  }
  return { provider, partial: (e: TranscriptEvent) => partial(e), final: (e: TranscriptEvent) => final(e), fail: (e: TranscriptionStatus = { error: 'Connection lost' }) => status(e), finalCallback: () => final }
}
const config = { sampleRate: 16000, maxSpeakers: 5, keyterms: [] }
const utterance = { utteranceId: 'turn:0', startMs: 0, endMs: 100, text: 'Check the status endpoint.', speaker: 0, isFinal: true }
const pcm = () => new ArrayBuffer(3200) // 100 ms
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(.5) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('reconnects only ASR, preserves transcript identity and rejects late old-connection callbacks', async () => {
  const first = engine(), second = engine(), connect = vi.fn(async () => ({ name: 'Deepgram', provider: second.provider })), events: RecoveryEvent[] = []
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect, e => events.push(e))
  const final = vi.fn(); wrapper.onFinal(final); wrapper.sendAudio(pcm()); first.final(utterance)
  const stale = first.finalCallback(); first.fail(); first.fail()
  wrapper.sendAudio(pcm()); await vi.advanceTimersByTimeAsync(501)
  expect(connect).toHaveBeenCalledTimes(1); expect(second.provider.sendAudio).toHaveBeenCalledTimes(1)
  stale({ ...utterance, text: 'Stale text' }); second.final(utterance)
  expect(final).toHaveBeenCalledTimes(2)
  expect(final.mock.calls[1][0].startMs).toBe(100)
  expect(final.mock.calls[1][0].speaker).toBe(1) // new connection, not assumed same voice
  expect(final.mock.calls[1][0].utteranceId).not.toBe(final.mock.calls[0][0].utteranceId)
  expect(events.some(e => e.state === 'gap')).toBe(true)
  await wrapper.disconnect()
})
it('buffers no more than two seconds, reports loss, and paces replay instead of bursting', async () => {
  const first = engine(), second = engine(), events: RecoveryEvent[] = []
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, async () => ({ name: 'Deepgram', provider: second.provider }), e => events.push(e))
  first.fail(); for (let i = 0; i < 50; i++) wrapper.sendAudio(pcm())
  await vi.advanceTimersByTimeAsync(501)
  expect(second.provider.sendAudio).toHaveBeenCalledTimes(1)
  const final = vi.fn(); wrapper.onFinal(final); second.final(utterance)
  expect(final.mock.calls[0][0].startMs).toBe(3000)
  await vi.advanceTimersByTimeAsync(1800)
  expect(second.provider.sendAudio).toHaveBeenCalledTimes(20)
  expect(events.reduce((total, e) => total + (e.droppedMs ?? 0), 0)).toBe(3000)
  await wrapper.disconnect()
})
it('caps reconnection rounds and emits one terminal error', async () => {
  const first = engine(), connect = vi.fn(async () => { throw new Error('Network failure') }), status = vi.fn()
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect)
  wrapper.onStatus(status); first.fail(); await vi.advanceTimersByTimeAsync(30_000)
  expect(connect).toHaveBeenCalledTimes(3); expect(status).toHaveBeenCalledTimes(1)
  wrapper.sendAudio(pcm()); expect(first.provider.sendAudio).not.toHaveBeenCalled()
})
it.each([401, 403, 404])('does not loop on a permanent reconnection failure (%i)', async status => {
  const first = engine(), connect = vi.fn(async () => { throw Object.assign(new Error('Unavailable'), { status }) })
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect)
  first.fail(); await vi.advanceTimersByTimeAsync(30_000); expect(connect).toHaveBeenCalledTimes(1)
  await wrapper.disconnect()
})
it('never reconnects a permission or policy denial', async () => {
  const first = engine(), connect = vi.fn()
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect)
  first.fail({ error: 'Permission denied', retryable: false }); await vi.advanceTimersByTimeAsync(30_000)
  expect(connect).not.toHaveBeenCalled()
})
it('Stop cancels backoff immediately and never restarts capture', async () => {
  const first = engine(), connect = vi.fn()
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect)
  first.fail(); await wrapper.disconnect(); await vi.advanceTimersByTimeAsync(30_000)
  expect(connect).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
})
it('cancellation retires even a late connector that ignores AbortSignal', async () => {
  const first = engine(), second = engine(), abort = new AbortController()
  let resolve!: (value: { name: string; provider: TranscriptionProvider }) => void
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, { ...config, signal: abort.signal }, () => new Promise(done => { resolve = done }))
  first.fail(); await vi.advanceTimersByTimeAsync(501); abort.abort()
  resolve({ name: 'Deepgram', provider: second.provider }); await vi.advanceTimersByTimeAsync(1000)
  expect(second.provider.disconnect).toHaveBeenCalledTimes(1); expect(second.provider.sendAudio).not.toHaveBeenCalled()
})
it('does not kill a recovered connection when the recovery deadline passes', async () => {
  const first = engine(), second = engine(); let signal!: AbortSignal
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, async next => { signal = next.signal!; return { name: 'Deepgram', provider: second.provider } })
  first.fail(); await vi.advanceTimersByTimeAsync(501); await vi.advanceTimersByTimeAsync(30_000)
  expect(signal.aborted).toBe(false); wrapper.sendAudio(pcm()); expect(second.provider.sendAudio).toHaveBeenCalledTimes(1)
  await wrapper.disconnect()
})
it('normal Stop preserves trailing finalized speech without reconnecting', async () => {
  const first = engine(), final = vi.fn(), connect = vi.fn()
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect)
  wrapper.onFinal(final); vi.mocked(first.provider.disconnect).mockImplementation(async () => { first.final(utterance) })
  await wrapper.disconnect(); expect(final).toHaveBeenCalledTimes(1); expect(connect).not.toHaveBeenCalled()
  first.final(utterance); expect(final).toHaveBeenCalledTimes(1)
})
it('silence is not interpreted as a failed connection', async () => {
  const first = engine(), connect = vi.fn()
  const wrapper = new RecoveringTranscription({ name: 'Deepgram', provider: first.provider }, config, connect)
  await vi.advanceTimersByTimeAsync(120_000); expect(connect).not.toHaveBeenCalled(); await wrapper.disconnect()
})
it('does not retry unknown failures', () => {
  expect(retryableTranscriptionFailure(new Error('Parser invariant failed'))).toBe(false)
  expect(retryableTranscriptionFailure(new DOMException('Denied', 'NotAllowedError'))).toBe(false)
})
