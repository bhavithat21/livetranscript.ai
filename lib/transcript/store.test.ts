import { describe, it, expect } from 'vitest'
import {
  mergeSegments,
  applyCorrection,
  splitSentences,
  sanitizeSegments,
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

describe('applyCorrection', () => {
  it('replaces text of the matching segment id', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('helo wrld', true))
    s = applyCorrection(s, s[0].id, 'hello world')
    expect(s[0].text).toBe('hello world')
  })
})
