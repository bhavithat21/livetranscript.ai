import { describe, it, expect } from 'vitest'
import { mergeRoomSegments, speakerSlot, isStrongRoomId, colorMap, segmentSlot, MAX_SPEAKERS } from './roomStore'
import type { RoomMessage } from './useRoom'
import type { Segment } from '@/lib/transcript/store'

const msg = (sender: string, speaker: number, text: string, isFinal: boolean): RoomMessage => ({
  sender,
  speaker,
  text,
  isFinal,
  startMs: 0,
  endMs: 0,
})

describe('mergeRoomSegments', () => {
  it('keeps different senders separate (no clobbering)', () => {
    let s: Segment[] = []
    s = mergeRoomSegments(s, msg('alice', 0, 'hello wor', false))
    s = mergeRoomSegments(s, msg('bob', 1, 'hel', false))
    s = mergeRoomSegments(s, msg('alice', 0, 'hello world', false))
    s = mergeRoomSegments(s, msg('bob', 1, 'hello', false))
    expect(s).toHaveLength(2)
    expect(s.find((x) => x.sender === 'alice')!.text).toBe('hello world')
    expect(s.find((x) => x.sender === 'bob')!.text).toBe('hello')
  })

  it('interleaves three concurrent speakers without merging them', () => {
    let s: Segment[] = []
    s = mergeRoomSegments(s, msg('a', 0, 'one', false))
    s = mergeRoomSegments(s, msg('b', 1, 'two', false))
    s = mergeRoomSegments(s, msg('c', 2, 'three', false))
    expect(s).toHaveLength(3)
    expect(s.map((x) => x.speaker)).toEqual([0, 1, 2])
  })

  it('appends a new segment after a sender interim is finalized', () => {
    let s: Segment[] = []
    s = mergeRoomSegments(s, msg('bob', 1, 'first', true))
    s = mergeRoomSegments(s, msg('bob', 1, 'second', false))
    const bobSegs = s.filter((x) => x.sender === 'bob')
    expect(bobSegs.map((x) => x.text)).toEqual(['first', 'second'])
  })
})

describe('speakerSlot', () => {
  it('assigns stable slots by sorted client id, identical for every participant', () => {
    const roster = ['u_charlie', 'u_alice', 'u_bob']
    // sorted → alice(0), bob(1), charlie(2); order of the roster array must not matter
    expect(speakerSlot('u_alice', roster)).toBe(0)
    expect(speakerSlot('u_bob', roster)).toBe(1)
    expect(speakerSlot('u_charlie', roster)).toBe(2)
    expect(speakerSlot('u_alice', [...roster].reverse())).toBe(0)
  })

  it('returns -1 for participants past the speaker cap', () => {
    const roster = Array.from({ length: MAX_SPEAKERS + 2 }, (_, i) => `u_${String.fromCharCode(97 + i)}`)
    expect(speakerSlot(roster[MAX_SPEAKERS], roster)).toBe(-1)
    expect(speakerSlot(roster[MAX_SPEAKERS - 1], roster)).toBe(MAX_SPEAKERS - 1)
  })
})

describe('isStrongRoomId', () => {
  it('rejects short, guessable, dictionary-word ids', () => {
    expect(isStrongRoomId('testmeeting')).toBe(false) // 11 chars, all lowercase
    expect(isStrongRoomId('standup')).toBe(false)
    expect(isStrongRoomId('aaaaaaaaaaaa')).toBe(false) // long but 1 distinct char
    expect(isStrongRoomId('team-standup')).toBe(false) // only 8 distinct, no upper/digit
  })
  it('accepts high-entropy generated ids (base64url, ~72 bits)', () => {
    expect(isStrongRoomId('K7bQ9-mZ2pXa')).toBe(true)
    expect(isStrongRoomId('aZ3f_Qb8Kd10')).toBe(true)
  })
  it('accepts friendly word-word-#### ids', () => {
    expect(isStrongRoomId('swift-otter-4821')).toBe(true)
    expect(isStrongRoomId('lunar-beacon-0007')).toBe(true)
  })
  it('rejects ids with unsafe characters', () => {
    expect(isStrongRoomId('room/../secret')).toBe(false)
    expect(isStrongRoomId('K7bQ9 mZ2pXa')).toBe(false)
  })
})

describe('colorMap / segmentSlot — cross-client color consistency', () => {
  const seg = (sender: string, speaker: number): Segment => ({
    id: Math.random(),
    speaker,
    text: 'x',
    isFinal: true,
    sender,
  })
  it('assigns the SAME color per sender regardless of the racy wire speaker slot', () => {
    // Both browsers see the same two senders; on the wire both stamped speaker=0.
    const segs = [seg('u_alice', 0), seg('u_bob', 0), seg('u_alice', 0)]
    const colors = colorMap(segs)
    expect(colors.get('u_alice')).not.toBe(colors.get('u_bob')) // distinct colors
    // And it's deterministic by sorted sender id — every client agrees.
    expect(segmentSlot(seg('u_alice', 0), colors)).toBe(0)
    expect(segmentSlot(seg('u_bob', 0), colors)).toBe(1)
  })
  it('falls back to the wire speaker for single-mic segments (no sender)', () => {
    const s: Segment = { id: 1, speaker: 3, text: 'x', isFinal: true }
    expect(segmentSlot(s, new Map())).toBe(3)
  })
})
