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
    // Sizing is inline fontSize now (so it can scale with the reader preference):
    // the emphasized line is visibly larger than the non-emphasized one.
    const px = (el: HTMLElement) => parseFloat(el.style.fontSize) || 0
    expect(px(repeated)).toBeGreaterThan(px(reference))
    // reference is visibly dimmed
    expect(reference.style.opacity).toBe('0.4')
  })
})

describe('TranscriptView speaker overrides', () => {
  const senderSegs: Segment[] = [
    { id: 1, speaker: 0, sender: 'u_abc', name: 'Ravi', text: 'first line.', isFinal: true },
  ]
  it('renders the local override name instead of the login name', () => {
    const { getByText, queryByText } = render(
      <TranscriptView
        segments={senderSegs}
        theme="light"
        readerMode={false}
        overrides={{ u_abc: { name: 'Coach' } }}
      />,
    )
    expect(getByText('Coach')).toBeTruthy()
    expect(queryByText('Ravi')).toBeNull()
  })
})
