// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { InterviewSession } from '@/lib/interview/session'

vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <a href="/dashboard">Library</a> }))
vi.mock('./LiveInterview', () => ({ LiveInterview: ({ onActivity }: { onActivity: (active: boolean) => void }) => <button onClick={() => onActivity(true)}>Start capture test</button> }))
vi.mock('./MockInterview', () => ({ MockInterview: ({ onComplete }: { onComplete: (session: InterviewSession) => void }) => {
  const [draft, setDraft] = useState('')
  return <><input aria-label="Mock draft" value={draft} onChange={(event) => setDraft(event.target.value)} /><button onClick={() => onComplete({ id: 'mock-test', kind: 'mock', title: 'Completed practice', createdAt: 1, durationSeconds: 20, transcript: draft, turns: [], captureNote: 'Mock' })}>Finish mock test</button></>
} }))
vi.mock('./InterviewFeedback', () => ({ InterviewFeedback: ({ sessions }: { sessions: InterviewSession[] }) => <div>{sessions.map((session) => <p key={session.id}>{session.title}</p>)}</div> }))
import { InterviewWorkspace } from './InterviewWorkspace'

afterEach(() => { cleanup(); localStorage.clear() })
describe('separate interview tabs', () => {
  it('links to implemented tools and keeps mobile keyboard focus in the visible controls', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    expect(screen.getByRole('link', { name: 'Transcripts' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.getByRole('link', { name: 'Repository' }).getAttribute('href')).toBe('/copilot?mode=repoInterview')
    expect(screen.getByRole('link', { name: 'Remote Assist' }).getAttribute('href')).toBe('/remote')
    const live = screen.getByRole('button', { name: 'Live Interview' })
    fireEvent.keyDown(live, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mock Interview' }))
    expect(screen.getByRole('button', { name: 'Mock Interview' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('shows exactly three named tabs and supports keyboard navigation', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    const live = screen.getByRole('tab', { name: 'Live Interview' })
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(live.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(live, { key: 'ArrowRight' })
    const mock = screen.getByRole('tab', { name: 'Mock Interview' })
    expect(mock.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(mock)
    fireEvent.keyDown(mock, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Interview Feedback' }).getAttribute('aria-selected')).toBe('true')
  })
  it('does not discard a mock draft when switching tabs', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mock Interview' }))
    fireEvent.change(screen.getByLabelText('Mock draft'), { target: { value: 'My answer is still here' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Live Interview' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Mock Interview' }))
    expect((screen.getByLabelText('Mock draft') as HTMLInputElement).value).toBe('My answer is still here')
  })
  it('keeps active live capture visible as a status on the feedback tab', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    fireEvent.click(screen.getByText('Start capture test'))
    fireEvent.click(screen.getByRole('tab', { name: 'Interview Feedback' }))
    expect(screen.getByText(/Live interview remains active/)).toBeTruthy()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getAllByRole('link', { name: 'Library' })[0], event)
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Finish the active interview')
  })
  it('saves completion and opens the feedback tab', () => {
    render(<InterviewWorkspace ownerId="alice" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mock Interview' }))
    fireEvent.change(screen.getByLabelText('Mock draft'), { target: { value: 'Candidate answer' } })
    fireEvent.click(screen.getByText('Finish mock test'))
    expect(screen.getByRole('tab', { name: 'Interview Feedback' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Completed practice')).toBeTruthy()
    cleanup()
    render(<InterviewWorkspace ownerId="bob" />)
    expect(screen.queryByText('Completed practice')).toBeNull()
  })
})
