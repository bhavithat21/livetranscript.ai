import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TranscriptView } from './TranscriptView'
import type { Segment } from '@/lib/transcript/store'

const segs: Segment[] = [
  { id: 1, speaker: 0, text: 'reference line', isFinal: true },
  { id: 2, speaker: 1, text: 'repeated line', isFinal: true },
]

describe('TranscriptView Shadow Mode', () => {
  it('emphasizes the shadow speaker with larger type and dims the other', () => {
    const { getByText } = render(
      <TranscriptView segments={segs} theme="light" readerMode={false} emphasizeSpeaker={1} />,
    )
    const repeated = getByText('repeated line').closest('p')!
    const reference = getByText('reference line').closest('p')!
    // emphasized line uses a large text class; reference does not
    expect(repeated.className).toMatch(/text-3xl|text-4xl/)
    expect(reference.className).not.toMatch(/text-3xl|text-4xl/)
    // reference is visibly dimmed
    expect(reference.style.opacity).toBe('0.4')
  })
})
