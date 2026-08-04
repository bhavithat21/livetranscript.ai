import { describe, it, expect } from 'vitest'
import {
  mergeSegments,
  applyCorrection,
  splitSentences,
  sanitizeSegments,
  paragraphize,
  type Segment,
} from './store'
import type { TranscriptEvent } from '@/lib/transcription/types'

const ev = (text: string, isFinal: boolean, speaker: number | null = 0): TranscriptEvent => ({
  text,
  isFinal,
  speaker,
  startMs: 0,
  endMs: 0,
})

describe('mergeSegments', () => {
  it('replaces a trailing interim with the next interim', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('hel', false))
    s = mergeSegments(s, ev('hello', false))
    expect(s).toHaveLength(1)
    expect(s[0].text).toBe('hello')
  })
  it('commits a final and starts fresh for the next interim', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('hello', true))
    s = mergeSegments(s, ev('world', false))
    expect(s.map((x) => x.text)).toEqual(['hello', 'world'])
    expect(s[0].isFinal).toBe(true)
  })
  it('derives ids from the list (starts at 1, no global counter across sessions)', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('one', true))
    s = mergeSegments(s, ev('two', true))
    expect(s.map((x) => x.id)).toEqual([1, 2])
    // a brand-new list restarts at 1 rather than continuing a module-global count
    let fresh: Segment[] = []
    fresh = mergeSegments(fresh, ev('again', true))
    expect(fresh[0].id).toBe(1)
  })
  it('returns the SAME array reference for an identical interim re-emit (no-op)', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('hel', false))
    const before = s
    const after = mergeSegments(s, ev('hel', false))
    expect(after).toBe(before) // React skips the re-render
  })
})

describe('sanitizeSegments', () => {
  it('drops malformed entries and coerces valid ones', () => {
    const out = sanitizeSegments([
      { id: 1, speaker: 0, text: 'ok', isFinal: true },
      'not an object',
      { speaker: 1 }, // no text → dropped
      { text: 'no id', isFinal: 'yes' }, // isFinal not boolean → false; id backfilled
    ])
    expect(out).toEqual([
      { id: 1, speaker: 0, text: 'ok', isFinal: true },
      { id: 2, speaker: null, text: 'no id', isFinal: false },
    ])
  })
  it('returns [] for non-array input and caps oversized text', () => {
    expect(sanitizeSegments('haxor')).toEqual([])
    const big = sanitizeSegments([{ text: 'a'.repeat(50_000), isFinal: true }])
    expect(big[0].text.length).toBe(10_000)
  })
})

describe('splitSentences', () => {
  it('splits a run-on line into one sentence per entry', () => {
    expect(splitSentences('Hello there. How are you? I am fine!')).toEqual([
      'Hello there.',
      'How are you?',
      'I am fine!',
    ])
  })
  it('keeps decimals and a single unterminated clause intact', () => {
    expect(splitSentences('Pi is 3.14 roughly')).toEqual(['Pi is 3.14 roughly'])
  })
  it('returns [] for blank text', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('paragraphize', () => {
  const seg = (id: number, text: string, startMs: number, endMs: number): Segment => ({
    id,
    speaker: 0,
    text,
    isFinal: true,
    startMs,
    endMs,
  })

  it('starts a new paragraph after a >= 2s pause', () => {
    const p = paragraphize([seg(1, 'one', 0, 1000), seg(2, 'two', 3000, 4000)])
    expect(p.map((x) => x.text)).toEqual(['one', 'two'])
  })

  it('keeps a continuous run in one paragraph', () => {
    const p = paragraphize([seg(1, 'one', 0, 1000), seg(2, 'two', 1200, 2000)])
    expect(p.map((x) => x.text)).toEqual(['one two'])
  })

  it('breaks a long block even with no pause', () => {
    const long = 'word '.repeat(50).trim()
    const p = paragraphize([seg(1, long, 0, 1000), seg(2, long, 1100, 2000)])
    expect(p).toHaveLength(2)
  })

  it('treats a rewound clock (provider reconnect) as no pause, not a break', () => {
    const p = paragraphize([seg(1, 'one', 9000, 10_000), seg(2, 'two', 0, 500)])
    expect(p).toHaveLength(1)
  })

  it('runs text together when timings are absent', () => {
    const p = paragraphize([
      { id: 1, speaker: 0, text: 'one', isFinal: true },
      { id: 2, speaker: 0, text: 'two', isFinal: true },
    ])
    expect(p.map((x) => x.text)).toEqual(['one two'])
  })

  it('hard-caps a single oversized segment, splitting on sentence boundaries', () => {
    const sentence = 'This clause runs on and on without pause. '
    const p = paragraphize([seg(1, sentence.repeat(20), 0, 60_000)])
    expect(p.length).toBeGreaterThan(1)
    for (const x of p) expect(x.text.length).toBeLessThanOrEqual(320)
    // Sentences stay whole — no mid-sentence cut.
    for (const x of p) expect(x.text).toMatch(/\.$/)
    // Overflow chunks are flagged so TranscriptView doesn't double-count them.
    expect(p[0].startsSegment).toBe(true)
    expect(p.slice(1).every((x) => !x.startsSegment)).toBe(true)
    expect(new Set(p.map((x) => x.key)).size).toBe(p.length) // keys stay unique
  })

  it('falls back to word boundaries for one sentence longer than the cap', () => {
    const p = paragraphize([seg(1, 'word '.repeat(200).trim(), 0, 60_000)])
    expect(p.length).toBeGreaterThan(1)
    for (const x of p) expect(x.text.length).toBeLessThanOrEqual(320)
    expect(p.map((x) => x.text).join(' ').split(/\s+/)).toHaveLength(200) // nothing dropped
  })

  it('keeps a single word longer than the cap intact rather than truncating', () => {
    const giant = 'x'.repeat(400)
    expect(paragraphize([seg(1, giant, 0, 1000)]).map((x) => x.text)).toEqual([giant])
  })

  it('marks a paragraph pending while any of its segments is interim', () => {
    const p = paragraphize([seg(1, 'one', 0, 1000), { ...seg(2, 'two', 1200, 2000), isFinal: false }])
    expect(p[0].isFinal).toBe(false)
  })
})

describe('applyCorrection', () => {
  it('replaces text of the matching segment id', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('helo wrld', true))
    s = applyCorrection(s, s[0].id, 'hello world')
    expect(s[0].text).toBe('hello world')
  })
})
