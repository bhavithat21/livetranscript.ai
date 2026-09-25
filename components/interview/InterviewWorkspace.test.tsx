// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { InterviewSession } from '@/lib/interview/session'

vi.mock('@/components/nav/Wordmark', () => ({ Wordmark: () => <span>LiveTranscript</span> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme control</span> }))
vi.mock('./LiveInterview', () => ({ LiveInterview: ({ onActivity }: { onActivity: (active: boolean) => void }) => <button onClick={() => onActivity(true)}>Start capture test</button> }))
vi.mock('./MockInterview', () => ({ MockInterview: ({ onComplete }: { onComplete: (session: InterviewSession) => void }) => {
  const [draft, setDraft] = useState('')
  return <><input aria-label="Mock draft" value={draft} onChange={(event) => setDraft(event.target.value)} /><button onClick={() => onComplete({ id: 'mock-test', kind: 'mock', title: 'Completed practice', createdAt: 1, durationSeconds: 20, transcript: draft, turns: [], captureNote: 'Mock' })}>Finish mock test</button></>
} }))
vi.mock('./InterviewFeedback', () => ({ InterviewFeedback: ({ sessions }: { sessions: InterviewSession[] }) => <div>{sessions.map((session) => <p key={session.id}>{session.title}</p>)}</div> }))
import { InterviewWorkspace } from './InterviewWorkspace'

function navLink(name: string) { return within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name }) }
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, '', '/') })
describe('interview views in the shared workspace', () => {
  it('links to implemented tools through the shared navigation', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    expect(navLink('Transcripts').getAttribute('href')).toBe('/dashboard')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace' })).getByText('More tools'))
    expect(navLink('Repository').getAttribute('href')).toBe('/interview/repository')
    expect(navLink('Remote assist').getAttribute('href')).toBe('/remote')
    expect(navLink('Live interview').getAttribute('aria-current')).toBe('page')
  })
  it('opens a linked view and synchronizes later hash changes without remounting', () => {
    window.history.replaceState(null, '', '/interview#mock')
    render(<InterviewWorkspace ownerId="alice" />)
    expect(navLink('Mock Lab').getAttribute('aria-current')).toBe('page')
    fireEvent.change(screen.getByLabelText('Mock draft'), { target: { value: 'Keep this scenario' } })
    act(() => { window.history.replaceState(null, '', '/interview#feedback'); window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(navLink('Feedback').getAttribute('aria-current')).toBe('page')
    fireEvent.click(navLink('Mock Lab'))
    expect(window.location.hash).toBe('#mock')
    expect((screen.getByLabelText('Mock draft') as HTMLInputElement).value).toBe('Keep this scenario')
  })
  it('does not discard a mock draft when switching views', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    fireEvent.click(navLink('Mock Lab'))
    fireEvent.change(screen.getByLabelText('Mock draft'), { target: { value: 'My answer is still here' } })
    fireEvent.click(navLink('Live interview'))
    fireEvent.click(navLink('Mock Lab'))
    expect((screen.getByLabelText('Mock draft') as HTMLInputElement).value).toBe('My answer is still here')
  })
  it('keeps capture active across views and blocks leaving until capture ends', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    fireEvent.click(screen.getByText('Start capture test'))
    fireEvent.click(navLink('Feedback'))
    expect(screen.getByText(/Live interview remains active/)).toBeTruthy()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(navLink('Transcripts'), event)
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Finish the active interview')
    fireEvent.click(screen.getByRole('button', { name: 'Return to session' }))
    expect(navLink('Live interview').getAttribute('aria-current')).toBe('page')
  })
  it('saves completion and opens Feedback without exposing history to another account', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    fireEvent.click(navLink('Mock Lab'))
    fireEvent.change(screen.getByLabelText('Mock draft'), { target: { value: 'Candidate answer' } })
    fireEvent.click(screen.getByText('Finish mock test'))
    expect(navLink('Feedback').getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Completed practice')).toBeTruthy()
    cleanup()
    render(<InterviewWorkspace ownerId="bob" />)
    expect(screen.queryByText('Completed practice')).toBeNull()
  })
})
