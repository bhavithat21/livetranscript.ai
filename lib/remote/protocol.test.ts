import { describe, expect, it } from 'vitest'
import { createRemoteInputGate, isRemoteKey, parseRemoteInput, parseRemoteNote } from './protocol'

describe('remote native input boundary', () => {
  it('accepts normalized corners, bounded scroll, and explicit button/key states', () => {
    for (const event of [
      { seq: 1, type: 'move', x: 0, y: 1 },
      { seq: 2, type: 'button', button: 'left', down: true },
      { seq: 3, type: 'button', button: 'middle', down: false },
      { seq: 4, type: 'key', key: 'Control', down: true },
      { seq: 5, type: 'key', key: 'a', down: false },
      { seq: 6, type: 'scroll', deltaX: -20, deltaY: 20 },
      { seq: 7, type: 'text', text: 'Readable code\n\twith unicode: 日本語' },
    ]) expect(parseRemoteInput(event)).toEqual(event)
  })

  it('rejects nonfinite/off-screen values, extra fields, coercion and excessive input', () => {
    for (const event of [
      null, [], {}, { seq: 0, type: 'move', x: 0, y: 0 },
      { seq: 1.5, type: 'move', x: 0, y: 0 },
      { seq: Number.MAX_SAFE_INTEGER + 1, type: 'move', x: 0, y: 0 },
      { seq: 1, type: 'move', x: -0.1, y: 0 },
      { seq: 1, type: 'move', x: Number.NaN, y: 0 },
      { seq: 1, type: 'move', x: 0, y: Infinity },
      { seq: 1, type: 'move', x: 0, y: '0' },
      { seq: 1, type: 'move', x: 0, y: 0, command: 'execute' },
      { seq: 1, type: 'button', button: 'other', down: true },
      { seq: 1, type: 'button', button: 'left', down: 'true' },
      { seq: 1, type: 'key', key: 'AudioVolumeUp', down: true },
      { seq: 1, type: 'key', key: '\0', down: true },
      { seq: 1, type: 'scroll', deltaX: 21, deltaY: 0 },
      { seq: 1, type: 'scroll', deltaX: 0.2, deltaY: 0 },
      { seq: 1, type: 'text', text: 'x'.repeat(1_001) },
      { seq: 1, type: 'text', text: 'hello\0there' },
      { seq: 1, type: 'text', text: '' },
    ]) expect(parseRemoteInput(event)).toBeNull()
  })

  it('rejects duplicate and out-of-order events without consuming a valid sequence on malformed input', () => {
    const accept = createRemoteInputGate()
    expect(accept({ seq: 1, type: 'key', key: 'Shift', down: true })).not.toBeNull()
    expect(accept({ seq: 1, type: 'key', key: 'Shift', down: false })).toBeNull()
    expect(accept({ seq: 50, type: 'move', x: -1, y: 0 })).toBeNull()
    expect(accept({ seq: 2, type: 'key', key: 'Shift', down: false })).not.toBeNull()
    expect(accept({ seq: 1, type: 'key', key: 'Shift', down: true })).toBeNull()
  })

  it('accepts Unicode scalar keys but refuses lone surrogates and unknown multi-character names', () => {
    for (const value of [' ', 'é', '日', '😀', 'F12', 'PageDown']) expect(isRemoteKey(value)).toBe(true)
    for (const value of ['', '\ud800', 'F13', 'exec', 'Dead', '\u007f']) expect(isRemoteKey(value)).toBe(false)
  })
})

describe('remote note boundary', () => {
  it('preserves readable code, multiline text and Unicode as ordinary text', () => {
    const text = '日本語: examine the empty-input case.\n\tconst total = a < b ? a : b;'
    expect(parseRemoteNote({ type: 'note', seq: 1, text: `  ${text}  ` })).toEqual({ type: 'note', seq: 1, text })
    expect(parseRemoteNote({ type: 'note', seq: 2, text: '日'.repeat(2_000) })?.text.length).toBe(2_000)
  })

  it('rejects sender spoofing, command fields, replay-invalid sequences and unbounded text', () => {
    for (const value of [
      null, [], {}, { type: 'note', seq: 0, text: 'hello' }, { type: 'note', seq: 1.5, text: 'hello' },
      { type: 'note', seq: '1', text: 'hello' }, { type: 'note', seq: 1, text: '' },
      { type: 'note', seq: 1, text: ' \n\t ' }, { type: 'note', seq: 1, text: 'x'.repeat(2_001) },
      { type: 'note', seq: 1, text: 'hello\0there' }, { type: 'note', seq: 1, text: '\u001b[31m' },
      { type: 'note', seq: 1, text: 'hello', sender: 'Host' },
      { type: 'note', seq: 1, text: 'hello', command: 'execute' },
    ]) expect(parseRemoteNote(value)).toBeNull()
  })
})
