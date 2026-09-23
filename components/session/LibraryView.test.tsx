import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionSummaryRow } from '@/app/(app)/session-actions'
import { LibraryView } from './LibraryView'

const now = Date.parse('2026-09-22T12:00:00Z')
function session(index: number, overrides: Partial<SessionSummaryRow> = {}): SessionSummaryRow {
  return {
    id: `session-${index}`, title: `Conversation ${index}`, durationSeconds: 120,
    createdAt: new Date(now - index * 60_000), summary: null,
    shareToken: null, shareExpiresAt: null, ...overrides,
  }
}
afterEach(cleanup)

describe('transcript library', () => {
  it('bounds pages and resets to the first result after a search', () => {
    render(<LibraryView sessions={Array.from({ length: 25 }, (_, index) => session(index + 1))} now={now} />)
    expect(within(screen.getByRole('list', { name: 'Transcripts' })).getAllByRole('listitem')).toHaveLength(12)
    expect((screen.getByRole('button', { name: 'Previous transcript page' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next transcript page' }))
    expect(screen.getByRole('status').textContent).toContain('13–24 of 25')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search transcripts' }), { target: { value: 'Conversation 25' } })
    expect(screen.getByRole('status').textContent).toContain('1–1 of 1')
    expect(screen.getByRole('link', { name: /Conversation 25/ }).getAttribute('href')).toBe('/session/session-25')
    expect(screen.queryByRole('navigation', { name: 'Transcript pages' })).toBeNull()
  })

  it('searches summary text, exposes clear, and restores search focus', () => {
    render(<LibraryView sessions={[session(1, { summary: { summary: 'Backpressure in the ingestion queue.' } }), session(2)]} now={now} />)
    const input = screen.getByRole('textbox', { name: 'Search transcripts' })
    fireEvent.change(input, { target: { value: 'backpressure' } })
    expect(screen.getByRole('status').textContent).toContain('1–1 of 1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear transcript search' }))
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('status').textContent).toContain('1–2 of 2')
  })

  it('filters only active share links and recovers from no results without losing data', () => {
    render(<LibraryView sessions={[
      session(1, { shareToken: 'active', shareExpiresAt: new Date(now + 100_000) }),
      session(2, { shareToken: 'expired', shareExpiresAt: new Date(now - 1) }),
      session(3),
    ]} now={now} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shared only' }))
    expect(screen.getByRole('status').textContent).toContain('1–1 of 1')
    expect(screen.queryByRole('link', { name: /Conversation 2/ })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search transcripts' }), { target: { value: 'missing' } })
    expect(screen.getByRole('heading', { name: 'No matching transcripts' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByRole('status').textContent).toContain('1–3 of 3')
    expect(screen.getByRole('button', { name: 'Shared only' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('clamps a later page when the loaded dataset shrinks', () => {
    const rows = Array.from({ length: 25 }, (_, index) => session(index + 1))
    const view = render(<LibraryView sessions={rows} now={now} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next transcript page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next transcript page' }))
    expect(screen.getByRole('status').textContent).toContain('25–25 of 25')
    view.rerender(<LibraryView sessions={rows.slice(0, 2)} now={now} />)
    expect(screen.getByRole('status').textContent).toContain('1–2 of 2')
    expect(screen.getByRole('link', { name: /Conversation 1/ })).toBeTruthy()
  })
})
