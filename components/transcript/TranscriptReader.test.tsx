import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { TranscriptReader } from './TranscriptReader'
const segments = [{ id: 1, speaker: 0, text: 'A partially', startMs: 0, endMs: 800, isFinal: true }, { id: 2, speaker: 0, text: 'recognized sentence.', startMs: 1000, endMs: 1800, isFinal: true }, { id: 3, speaker: 1, text: 'Thanks.', startMs: 2000, endMs: 2400, isFinal: false }]
afterEach(cleanup)
describe('shared read-only transcript', () => {
  it('defaults to paragraphs, exposes original segments, and never loses words', () => {
    const { container, getByRole } = render(<TranscriptReader segments={segments} />)
    expect(container.textContent).toContain('A partially recognized sentence.')
    fireEvent.click(getByRole('button', { name: 'Original segments' }))
    expect(container.textContent).toContain('recognized sentence.')
    expect(getByRole('button', { name: 'Original segments' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(getByRole('button', { name: 'Reading view' }))
    expect(container.textContent).toContain('A partially recognized sentence.')
  })
  it('labels unfinalized speech rather than pretending the engine confirmed it', () => {
    const { getByText } = render(<TranscriptReader segments={segments} />)
    expect(getByText('Unfinalized')).toBeTruthy(); expect(getByText('00:00')).toBeTruthy()
  })
})
