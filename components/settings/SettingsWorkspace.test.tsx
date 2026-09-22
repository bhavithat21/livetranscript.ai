import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsWorkspace } from './SettingsWorkspace'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { useResponsePreferences } from '@/lib/copilot/useResponsePreferences'

vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <span>Home</span> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme</span> }))

function textFile(text: string, name = 'resume.txt', type = 'text/plain') {
  const file = new File([text], name, { type })
  Object.defineProperty(file, 'text', { value: async () => text })
  return file
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({ test: 'keep-router-state' }, '', '/settings')
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Settings workspace', () => {
  it('supports arrow/Home/End tab navigation, retains router history state, and restores the selected section', () => {
    const view = render(<SettingsWorkspace />)
    const profile = screen.getByRole('tab', { name: 'Profile' })
    const answers = screen.getByRole('tab', { name: 'AI answers' })
    const appearance = screen.getByRole('tab', { name: 'Appearance' })
    expect(profile.getAttribute('aria-selected')).toBe('true')
    expect(answers.tabIndex).toBe(-1)
    profile.focus()
    fireEvent.keyDown(profile, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(answers)
    expect(answers.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('settings-tab-answers')
    fireEvent.keyDown(answers, { key: 'End' })
    expect(document.activeElement).toBe(appearance)
    expect(window.location.hash).toBe('#appearance')
    expect(window.history.state).toEqual({ test: 'keep-router-state' })
    view.unmount()
    render(<SettingsWorkspace />)
    expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Appearance' }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shares profile edits with the existing copilot store and restores an undoable clear', () => {
    render(<SettingsWorkspace />)
    const profile = renderHook(useCandidateProfile)
    fireEvent.change(screen.getByLabelText('Resume and experience'), { target: { value: 'I built a streaming service.' } })
    fireEvent.change(screen.getByLabelText('Target job description'), { target: { value: 'Staff engineer, distributed systems.' } })
    expect(profile.result.current.contextBlock()).toContain('I built a streaming service.')
    expect(profile.result.current.jd).toBe('Staff engineer, distributed systems.')
    fireEvent.click(screen.getByRole('tab', { name: 'AI answers' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }))
    expect((screen.getByLabelText('Resume and experience') as HTMLTextAreaElement).value).toBe('I built a streaming service.')
    fireEvent.click(screen.getByRole('button', { name: 'Clear background' }))
    expect(profile.result.current.hasProfile).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Undo clear' }))
    expect(profile.result.current.hasProfile).toBe(true)
    expect(profile.result.current.resume).toBe('I built a streaming service.')
    expect(profile.result.current.jd).toBe('Staff engineer, distributed systems.')
  })

  it('imports text locally and keeps previous context on invalid or oversized files', async () => {
    render(<SettingsWorkspace />)
    const input = screen.getByLabelText('Import resume text')
    fireEvent.change(input, { target: { files: [textFile('A real project with a measured result.')] } })
    await screen.findByText(/Resume and experience imported/)
    expect((screen.getByLabelText('Resume and experience') as HTMLTextAreaElement).value).toBe('A real project with a measured result.')
    fireEvent.change(input, { target: { files: [textFile('binary', 'resume.pdf', 'application/pdf')] } })
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a .txt or .md file')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { files: [textFile('A'.repeat(12_001))] } })
    expect((await screen.findByRole('alert')).textContent).toContain('12,000 characters')
    expect((screen.getByLabelText('Resume and experience') as HTMLTextAreaElement).value).toBe('A real project with a measured result.')
  })

  it('prevents a delayed import from overwriting a newer typed profile', async () => {
    let resolveText!: (value: string) => void
    const file = new File(['incoming'], 'resume.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { value: () => new Promise<string>((resolve) => { resolveText = resolve }) })
    render(<SettingsWorkspace />)
    fireEvent.change(screen.getByLabelText('Import resume text'), { target: { files: [file] } })
    expect(screen.getByText('Reading file…')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Resume and experience'), { target: { value: 'My newer edit.' } })
    await act(async () => resolveText('Older imported text.'))
    expect((screen.getByLabelText('Resume and experience') as HTMLTextAreaElement).value).toBe('My newer edit.')
    expect(JSON.parse(localStorage.getItem('lt.profile')!).resume).toBe('My newer edit.')
  })

  it('uses the existing answer preferences and keeps them across a new mount', () => {
    const view = render(<SettingsWorkspace />)
    const shared = renderHook(useResponsePreferences)
    fireEvent.click(screen.getByRole('tab', { name: 'AI answers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }))
    fireEvent.change(screen.getByLabelText('Answer tone'), { target: { value: 'technical' } })
    fireEvent.click(screen.getByLabelText('Include likely follow-up questions'))
    expect(shared.result.current.preferences).toEqual({ format: 'detailed', tone: 'technical', followups: true })
    expect(JSON.parse(localStorage.getItem('lt.answerPreferences')!)).toEqual(shared.result.current.preferences)
    view.unmount()
    render(<SettingsWorkspace />)
    expect(screen.getByRole('button', { name: 'Detailed' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Answer tone') as HTMLSelectElement).value).toBe('technical')
  })

  it('persists vocabulary choices, keeps the base pack enabled and offers real recording navigation', () => {
    render(<SettingsWorkspace />)
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }))
    const panel = screen.getByRole('tabpanel')
    const coding = within(panel).getByRole('button', { name: /Coding & algorithms/ })
    const wasActive = coding.getAttribute('aria-pressed') === 'true'
    fireEvent.click(coding)
    expect(coding.getAttribute('aria-pressed')).toBe(String(!wasActive))
    expect(JSON.parse(localStorage.getItem('lt.keytermPacks')!).includes('coding')).toBe(!wasActive)
    const base = within(panel).getByRole('button', { name: /Core tech/ }) as HTMLButtonElement
    expect(base.disabled).toBe(true)
    expect(base.getAttribute('aria-pressed')).toBe('true')
    expect(within(panel).getByRole('link', { name: 'Open audio setup' }).getAttribute('href')).toBe('/record')
  })

  it('preserves an appearance draft when visiting another settings tab', () => {
    render(<SettingsWorkspace />)
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }))
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Workspace Notes' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }))
    expect((screen.getByLabelText('App name') as HTMLInputElement).value).toBe('Workspace Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(localStorage.getItem('lt.appName')).toBe('Workspace Notes')
  })

  it('shows storage failure instead of a false saved status for background edits', () => {
    render(<SettingsWorkspace />)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    fireEvent.change(screen.getByLabelText('Resume and experience'), { target: { value: 'This session only.' } })
    expect(screen.getByRole('alert').textContent).toContain('won’t survive a reload')
    expect((screen.getByLabelText('Resume and experience') as HTMLTextAreaElement).value).toBe('This session only.')
  })
})
