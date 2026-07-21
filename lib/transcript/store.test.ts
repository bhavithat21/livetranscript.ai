import { describe, it, expect } from 'vitest'
import { mergeSegments, applyCorrection, type Segment } from './store'
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
})

describe('applyCorrection', () => {
  it('replaces text of the matching segment id', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('helo wrld', true))
    s = applyCorrection(s, s[0].id, 'hello world')
    expect(s[0].text).toBe('hello world')
  })
})
