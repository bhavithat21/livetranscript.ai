import { describe, it, expect } from 'vitest'
import { mergeRoomSegments } from './roomStore'
import type { RoomMessage } from './useRoom'
import type { Segment } from '@/lib/transcript/store'

const msg = (role: 'reader' | 'repeater', text: string, isFinal: boolean): RoomMessage => ({
  role,
  text,
  isFinal,
  speaker: null,
  startMs: 0,
  endMs: 0,
})

describe('mergeRoomSegments', () => {
  it('keeps reader and repeater interims separate (no clobbering)', () => {
    let s: Segment[] = []
    s = mergeRoomSegments(s, msg('reader', 'hello wor', false))
    s = mergeRoomSegments(s, msg('repeater', 'hel', false))
    s = mergeRoomSegments(s, msg('reader', 'hello world', false))
    s = mergeRoomSegments(s, msg('repeater', 'hello', false))
    expect(s).toHaveLength(2)
    expect(s.find((x) => x.speaker === 0)!.text).toBe('hello world') // reader
    expect(s.find((x) => x.speaker === 1)!.text).toBe('hello') // repeater
  })

  it('appends a new segment after the role interim is finalized', () => {
    let s: Segment[] = []
    s = mergeRoomSegments(s, msg('repeater', 'first', true))
    s = mergeRoomSegments(s, msg('repeater', 'second', false))
    const repeaterSegs = s.filter((x) => x.speaker === 1)
    expect(repeaterSegs.map((x) => x.text)).toEqual(['first', 'second'])
  })
})
