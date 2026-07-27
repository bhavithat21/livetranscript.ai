import { describe, it, expect } from 'vitest'
import { parseDraftStream, DRAFT_SENTINEL, REFINED_SENTINEL } from './draftProtocol'

describe('parseDraftStream', () => {
  it('treats a plain stream (no sentinel) as the final answer', () => {
    expect(parseDraftStream('Use a hash map for O(n).')).toEqual({
      text: 'Use a hash map for O(n).',
      phase: 'final',
    })
  })

  it('surfaces the draft while only the draft sentinel is present', () => {
    const raw = `${DRAFT_SENTINEL}Quick take: hash map.`
    expect(parseDraftStream(raw)).toEqual({ text: 'Quick take: hash map.', phase: 'draft' })
  })

  it('switches to the refined answer once the refined sentinel arrives', () => {
    const raw = `${DRAFT_SENTINEL}Quick take: hash map.${REFINED_SENTINEL}**Approach** Use a hash map because…`
    expect(parseDraftStream(raw)).toEqual({
      text: '**Approach** Use a hash map because…',
      phase: 'refined',
    })
  })

  it('handles an empty refined body (deep answer just started)', () => {
    const raw = `${DRAFT_SENTINEL}draft${REFINED_SENTINEL}`
    expect(parseDraftStream(raw)).toEqual({ text: '', phase: 'refined' })
  })
})
