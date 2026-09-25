import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceShell } from './WorkspaceShell'

vi.mock('./Wordmark', () => ({ Wordmark: () => <span>LiveTranscript</span> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme control</span> }))
afterEach(cleanup)

function desktopNavigation() { return within(screen.getByRole('navigation', { name: 'Workspace' })) }

describe('WorkspaceShell navigation', () => {
  it('keeps in-page interview transitions mounted without triggering the exit guard', () => {
    const changeView = vi.fn()
    const guard = vi.fn()
    render(<WorkspaceShell active="interview" interviewView="live" onInterviewViewChange={changeView} onNavigate={guard}><main>Active capture</main></WorkspaceShell>)
    fireEvent.click(desktopNavigation().getByRole('link', { name: 'Mock Lab' }))
    expect(changeView).toHaveBeenCalledWith('mock')
    expect(guard).not.toHaveBeenCalled()
    expect(screen.getByText('Active capture')).toBeTruthy()
  })

  it('lets capture owners block departure, including modified navigation clicks', () => {
    const guard = vi.fn((event) => event.preventDefault())
    const changeView = vi.fn()
    render(<WorkspaceShell active="interview" onNavigate={guard} onInterviewViewChange={changeView}><main>Active capture</main></WorkspaceShell>)
    expect(fireEvent.click(desktopNavigation().getByRole('link', { name: 'Settings' }))).toBe(false)
    expect(fireEvent.click(desktopNavigation().getByRole('link', { name: 'Mock Lab' }), { ctrlKey: true })).toBe(false)
    expect(guard).toHaveBeenCalledTimes(2)
    expect(changeView).not.toHaveBeenCalled()
  })

  it('provides deep links and exactly one selected destination per navigation', () => {
    render(<WorkspaceShell active="repository"><main>Repository</main></WorkspaceShell>)
    const nav = desktopNavigation()
    expect(nav.getByRole('link', { name: 'Mock Lab' }).getAttribute('href')).toBe('/interview#mock')
    expect(nav.getByRole('link', { name: 'Repository' }).getAttribute('aria-current')).toBe('page')
    expect(nav.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('closes the mobile disclosure with Escape and restores keyboard focus', () => {
    render(<WorkspaceShell active="copilot"><main>AI workspace</main></WorkspaceShell>)
    const trigger = screen.getByLabelText('Open workspace navigation')
    const details = trigger.closest('details')!
    fireEvent.click(trigger)
    expect(details.open).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps mobile navigation open when a capture owner blocks a link', () => {
    render(<WorkspaceShell active="interview" onNavigate={event => event.preventDefault()}><main>Active capture</main></WorkspaceShell>)
    const trigger = screen.getByLabelText('Open workspace navigation')
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Mobile workspace' })).getByText('More tools'))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Mobile workspace' })).getByRole('link', { name: 'AI workspace' }))
    expect(trigger.closest('details')!.open).toBe(true)
    fireEvent.pointerDown(screen.getByText('Active capture'))
    expect(trigger.closest('details')!.open).toBe(false)
  })

  it('restores visible focus after selecting an interview view from mobile navigation', () => {
    const changeView = vi.fn()
    render(<WorkspaceShell active="interview" onInterviewViewChange={changeView}><main>Interview</main></WorkspaceShell>)
    const trigger = screen.getByLabelText('Open workspace navigation')
    fireEvent.click(trigger)
    const link = within(screen.getByRole('navigation', { name: 'Mobile workspace' })).getByRole('link', { name: 'Feedback' })
    link.focus()
    fireEvent.click(link)
    expect(changeView).toHaveBeenCalledWith('feedback')
    expect(trigger.closest('details')!.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })
})
