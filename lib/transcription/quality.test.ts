import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deepgramResult, assemblyResult } from './results'
import { boundedKeyterms, vocabularyTerms, readRecognitionMode } from './recognition'
import { DeepgramProvider } from './deepgram'
import { AssemblyAIProvider } from './assemblyai'
import { mergeSegments, sanitizeSegments, type Segment } from '@/lib/transcript/store'

const dg = (extra = {}) => ({ start: 0, duration: 1, is_final: true, channel: { alternatives: [{ transcript: 'Hello. Hi.', words: [{ punctuated_word: 'Hello.', speaker: 0, start: 0, end: .4 }, { punctuated_word: 'Hi.', speaker: 1, start: .5, end: 1 }] }] }, ...extra })
const aai = (transcript: string, final = true, order = 0) => ({ type: 'Turn', transcript, turn_order: order, end_of_turn: final, speaker_label: 'A', words: [] })
const label = (value: unknown) => value === 'A' ? 0 : value === 'B' ? 1 : null

describe('recognition and revision contracts, synthetic input only', () => {
  it('preserves mid-result speaker changes with exact word timing', () => {
    const event = deepgramResult(dg(), 'one')!
    expect(event.speaker).toBe(null)
    expect(event.parts).toEqual([{ text: 'Hello.', speaker: 0, startMs: 0, endMs: 400 }, { text: 'Hi.', speaker: 1, startMs: 500, endMs: 1000 }])
    const result = mergeSegments([], event)
    expect(result.map(part => part.speaker)).toEqual([0, 1])
    expect(result.map(part => part.text).join(' ')).toBe('Hello. Hi.')
  })
  it('abstains on incomplete word alignment instead of deleting recognized words', () => {
    const data = dg(); data.channel.alternatives[0].transcript = 'Hello. Hi. More words.'
    const event = deepgramResult(data, 'one')!
    expect(event.parts).toBeUndefined()
    expect(event.text).toBe('Hello. Hi. More words.')
    expect(event.speaker).toBe(null)
  })
  it('does not make up speech on empty or malformed content', () => {
    for (const data of [{}, { channel: { alternatives: [{}] } }, { channel: { alternatives: [{ transcript: '' }] } }]) expect(deepgramResult(data, 'one')).toBeNull()
    expect(assemblyResult({ type: 'Termination' }, 'one', label)).toBeNull()
  })
  it('replaces AssemblyAI formatted revisions rather than duplicating a completed turn', () => {
    let rows = mergeSegments([], assemblyResult(aai('hello', false), 'one', label)!)
    rows = mergeSegments(rows, assemblyResult(aai('hello'), 'one', label)!)
    rows = mergeSegments(rows, assemblyResult(aai('Hello.'), 'one', label)!)
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(1); expect(rows[0].text).toBe('Hello.')
    expect(mergeSegments(rows, assemblyResult(aai('Hello.', false), 'one', label)!)).toBe(rows)
    expect(mergeSegments(rows, assemblyResult(aai('Hello.'), 'one', label)!)).toBe(rows)
  })
  it('keeps genuine repeated speech on a different turn or connection', () => {
    let rows: Segment[] = []
    for (const [order, stream] of [[0, 'one'], [1, 'one'], [0, 'two']] as const) rows = mergeSegments(rows, assemblyResult(aai('Yes.', true, order), stream, label)!)
    expect(rows).toHaveLength(3)
  })
  it('late formatting cannot overwrite the newer in-progress turn', () => {
    let rows = mergeSegments([], assemblyResult(aai('hello'), 'one', label)!)
    rows = mergeSegments(rows, assemblyResult(aai('Next thought', false, 1), 'one', label)!)
    rows = mergeSegments(rows, assemblyResult(aai('Hello.'), 'one', label)!)
    expect(rows.map(row => row.text)).toEqual(['Hello.', 'Next thought'])
  })
  it('stores recognition confidence only when finite and bounded', () => {
    const result = sanitizeSegments([{ text: 'a', confidence: .7, utteranceId: 'stream:1' }, { text: 'b', confidence: NaN }, { text: 'c', confidence: 5 }])
    expect(result[0]).toMatchObject({ confidence: .7, utteranceId: 'stream:1' })
    expect(result[1].confidence).toBeUndefined(); expect(result[2].confidence).toBeUndefined()
  })
  it('custom vocabulary preserves spelling, deduplicates and rejects malformed terms', () => {
    expect(boundedKeyterms(vocabularyTerms('Project Atlas, webhook\nWebHook,  , API'))).toEqual(['Project Atlas', 'webhook', 'API'])
    expect(boundedKeyterms(['x'.repeat(100), 'useful', 'bad\nterm'])).toEqual(['useful'])
  })
  it('enforces both term count and conservative prompt byte budget including separators', () => {
    const terms = boundedKeyterms(Array.from({ length: 1000 }, (_, i) => `technical-${i}`))
    expect(terms.length).toBeLessThanOrEqual(100)
    expect(new TextEncoder().encode(terms.join(' ') + ' ').length).toBeLessThanOrEqual(480)
  })
  it('recognition mode handles blocked or malformed storage', () => {
    localStorage.setItem('lt.recognitionMode', 'invalid')
    expect(readRecognitionMode()).toBe('balanced')
    localStorage.setItem('lt.recognitionMode', '"careful"')
    expect(readRecognitionMode()).toBe('careful')
    localStorage.removeItem('lt.recognitionMode')
  })
})

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  constructor(public url: string) { Socket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
const engines = [
  { name: 'Deepgram', make: () => new DeepgramProvider(), frame: (text: string, order: number) => ({ start: order, is_final: true, channel: { alternatives: [{ transcript: text, words: [] }] } }), terminal: 'Metadata' },
  { name: 'AssemblyAI', make: () => new AssemblyAIProvider(), frame: (text: string, order: number) => aai(text, true, order), terminal: 'Termination' },
]
for (const engine of engines) describe(`${engine.name} protocol fidelity`, () => {
  beforeEach(() => {
    vi.useFakeTimers(); Socket.instances = []
    vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ token: 'fixture' }) })))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  async function connected(careful = false) {
    const provider = engine.make()
    const connection = provider.connect({ sampleRate: 16000, keyterms: [], maxSpeakers: 5, recognitionMode: careful ? 'careful' : 'balanced' })
    await Promise.resolve(); await Promise.resolve()
    const socket = Socket.instances[0]; socket.open(); await connection
    return { provider, socket }
  }
  it('keeps interim captions on while using a deliberate finalization preset', async () => {
    const { provider, socket } = await connected(true)
    const params = new URL(socket.url).searchParams
    if (engine.name === 'Deepgram') { expect(params.get('endpointing')).toBe('500'); expect(params.get('interim_results')).toBe('true'); expect(params.has('no_delay')).toBe(false) }
    else expect(params.get('mode')).toBe('max_accuracy')
    const done = provider.disconnect(); socket.message({ type: engine.terminal }); await done
  })
  it('flushes multiple trailing finals and waits for terminal acknowledgement', async () => {
    const { provider, socket } = await connected()
    const final = vi.fn(); provider.onFinal(final)
    let finished = false
    const done = provider.disconnect().then(() => { finished = true })
    socket.message(engine.frame('First final.', 1)); await Promise.resolve()
    expect(finished).toBe(false)
    socket.message(engine.frame('Last final.', 2))
    socket.message({ type: engine.terminal }); await done
    expect(final).toHaveBeenCalledTimes(2)
    socket.message(engine.frame('Too late.', 3))
    expect(final).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('installs the shutdown acknowledgement handler before sending', async () => {
    const { provider, socket } = await connected()
    socket.send.mockImplementation(() => socket.message({ type: engine.terminal }))
    await provider.disconnect(); expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds shutdown when the server stops responding', async () => {
    const { provider, socket } = await connected()
    const done = provider.disconnect()
    await vi.advanceTimersByTimeAsync(2000); await done
    expect(socket.close).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores invalid JSON without destroying the live connection', async () => {
    const { provider, socket } = await connected()
    expect(() => socket.onmessage?.({ data: '{broken' })).not.toThrow()
    const final = vi.fn(); provider.onFinal(final); socket.message(engine.frame('Still here.', 1)); expect(final).toHaveBeenCalledOnce()
    const done = provider.disconnect(); socket.message({ type: engine.terminal }); await done
  })
})
