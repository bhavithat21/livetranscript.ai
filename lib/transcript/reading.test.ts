import { describe, it, expect } from 'vitest'
import { readingBlocks, transcriptTime } from './reading'
import type { Segment } from './store'
const line = (id: number, text: string, speaker = 0): Segment => ({ id, text, speaker, isFinal: true, startMs: id * 1500, endMs: id * 1500 + 900 })
describe('lossless transcript presentation', () => {
  it('joins adjacent fragments without inventing or correcting words', () => {
    const source = [line(1, 'What is the'), line(2, 'purpose of this module?')]
    const blocks = readingBlocks(source)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].paragraphs[0].map(part => part.text).join(' ')).toBe('What is the purpose of this module?')
    expect(source[0].text).toBe('What is the')
  })
  it('does not repeat a header on every segment after 30 seconds', () => {
    const source = Array.from({ length: 100 }, (_, i) => line(i + 1, 'This is another recognized fragment.'))
    const blocks = readingBlocks(source)
    expect(blocks.length).toBeLessThan(8)
    expect(blocks.flatMap(block => block.paragraphs.flat())).toEqual(source)
  })
  it('actual speaker changes split single-stream turns', () => {
    expect(readingBlocks([line(1, 'Hello.', 0), line(2, 'Hello.', 1)])).toHaveLength(2)
  })
  it('stable room senders take precedence over the wire color label', () => {
    expect(readingBlocks([{ ...line(1, 'One.', 0), sender: 'one' }, { ...line(2, 'Two.', 1), sender: 'one' }])).toHaveLength(1)
    expect(readingBlocks([{ ...line(1, 'One.', 0), sender: 'one' }, { ...line(2, 'Two.', 0), sender: 'two' }])).toHaveLength(2)
  })
  it('keeps repeated acknowledgements and unfinalized words', () => {
    const source = [line(1, 'Yes.'), line(2, 'Yes.'), { ...line(3, 'Goodbye.'), isFinal: false }]
    const saved = JSON.stringify(source)
    expect(readingBlocks(source)[0].paragraphs[0].map(s => s.text)).toEqual(['Yes.', 'Yes.', 'Goodbye.'])
    expect(JSON.stringify(source)).toBe(saved)
  })
  it('a long pause or stream rewind starts a new block', () => {
    expect(readingBlocks([line(1, 'Before.'), line(90, 'After.')])).toHaveLength(2)
    expect(readingBlocks([line(90, 'Before.'), line(1, 'After.')])).toHaveLength(2)
  })
  it('timestamps handle zero, missing values and long sessions', () => {
    expect(transcriptTime(0)).toBe('00:00'); expect(transcriptTime(120000)).toBe('02:00'); expect(transcriptTime()).toBeNull(); expect(transcriptTime(NaN)).toBeNull()
  })
})
