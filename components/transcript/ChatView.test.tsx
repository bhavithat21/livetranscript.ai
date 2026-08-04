import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { ChatView } from './ChatView'
import type { Segment } from '@/lib/transcript/store'

// One speaker, one continuous turn — the case that used to render as a single
// run-on bubble. Segments 1-2 run together; 3 follows a 3s pause.
const monologue: Segment[] = [
  { id: 1, speaker: 0, sender: 'u_a', name: 'Ravi', text: 'So the rollout starts Monday.', isFinal: true, startMs: 0, endMs: 2000 },
  { id: 2, speaker: 0, sender: 'u_a', name: 'Ravi', text: 'We staged it behind a flag.', isFinal: true, startMs: 2300, endMs: 4000 },
  { id: 3, speaker: 0, sender: 'u_a', name: 'Ravi', text: 'Any concerns before then?', isFinal: true, startMs: 7000, endMs: 9000 },
]

const bubbles = (c: HTMLElement) => Array.from(c.querySelectorAll('.glass'))

describe('ChatView speaker colors', () => {
  // Both senders carry speaker:0 on the wire — the racy roster value. Colors must
  // come from sender identity instead, or every bubble renders the same color.
  const twoSpeakers: Segment[] = [
    { id: 1, speaker: 0, sender: 'u_a', name: 'Ravi', text: 'Mine.', isFinal: true, startMs: 0, endMs: 1000 },
    { id: 2, speaker: 0, sender: 'u_b', name: 'Priya', text: 'Also mine.', isFinal: true, startMs: 4000, endMs: 5000 },
  ]

  it('gives two senders distinct colors even when the wire slot is identical', () => {
    const { getByText } = render(<ChatView segments={twoSpeakers} theme="dark" />)
    const ravi = getByText('Ravi').style.color
    const priya = getByText('Priya').style.color
    expect(ravi).toBeTruthy()
    expect(ravi).not.toBe(priya)
  })

  it('uses the dark palette when theme is dark', () => {
    // Scoped with `within` — both renders share document.body, so an unscoped
    // getByText would match Ravi twice.
    const label = (theme: 'light' | 'dark') =>
      within(render(<ChatView segments={twoSpeakers} theme={theme} />).container).getByText('Ravi').style.color
    expect(label('light')).toBe('rgb(29, 78, 216)') // #1d4ed8, AA on paper
    expect(label('dark')).toBe('rgb(147, 197, 253)') // #93c5fd, AA on near-black
  })
})

describe('ChatView paragraph breaks', () => {
  it('splits one speaker turn into a bubble per >= 2s pause', () => {
    const { container, getAllByText } = render(<ChatView segments={monologue} />)
    const b = bubbles(container)
    expect(b).toHaveLength(2)
    expect(b[0].textContent).toBe('So the rollout starts Monday.We staged it behind a flag.')
    expect(b[1].textContent).toBe('Any concerns before then?')
    // The whole turn stays under ONE name label — the split is within the turn.
    expect(getAllByText('Ravi')).toHaveLength(1)
  })

  it('keeps a gapless turn as a single bubble', () => {
    const gapless = monologue.map((s, i) => ({ ...s, startMs: i * 2000, endMs: i * 2000 + 1900 }))
    expect(bubbles(render(<ChatView segments={gapless} />).container)).toHaveLength(1)
  })

  it('still renders when the ASR provider supplies no timings', () => {
    const untimed = monologue.map((s) => ({ ...s, startMs: undefined, endMs: undefined }))
    expect(bubbles(render(<ChatView segments={untimed} />).container)).toHaveLength(1)
  })
})
