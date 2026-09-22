import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: {
    segments: [], transcript: '', getTranscript: vi.fn(() => ''),
    status: 'idle', error: null as string | null, engine: null, level: 0,
    start: vi.fn(), stop: vi.fn(), clear: vi.fn(),
  },
}))

vi.mock('@/lib/copilot/useCopilotCapture', () => ({ useCopilotCapture: () => mocks.capture }))
vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <span>Home</span> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme</span> }))
vi.mock('@/components/copilot/CopilotPanel', () => ({
  CopilotPanel: ({ getTranscript, variant }: { getTranscript: () => string; variant: string }) => <div aria-label="AI panel" data-variant={variant}>{getTranscript()}</div>,
}))

import { CopilotWorkspace } from './CopilotWorkspace'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.capture.status = 'idle'
  mocks.capture.transcript = ''
  mocks.capture.error = null
  mocks.capture.getTranscript.mockReturnValue('')
})
afterEach(cleanup)

describe('standalone AI workspace', () => {
  it('opens a working AI surface without starting audio or requiring a meeting', () => {
    render(<CopilotWorkspace />)
    expect(screen.getByLabelText('AI panel').getAttribute('data-variant')).toBe('workspace')
    expect(screen.getByText('Type a question to begin. No meeting needed.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'AI Copilot' }).getAttribute('aria-current')).toBe('page')
    expect(mocks.capture.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Audio source'), { target: { value: 'system' } })
    expect(mocks.capture.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }))
    expect(mocks.capture.start).toHaveBeenCalledExactlyOnceWith('system')
  })

  it('keeps cancellation available while permission or connection is pending', () => {
    mocks.capture.status = 'starting'
    render(<CopilotWorkspace />)
    expect((screen.getByLabelText('Audio source') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.capture.stop).toHaveBeenCalledOnce()
    expect(mocks.capture.start).not.toHaveBeenCalled()
  })

  it('retains stopped context for the AI and offers explicit local clearing', () => {
    mocks.capture.transcript = 'Why does this request retry twice?'
    mocks.capture.getTranscript.mockReturnValue(mocks.capture.transcript)
    render(<CopilotWorkspace />)
    expect(screen.getByLabelText('AI panel').textContent).toContain('Why does this request retry twice?')
    fireEvent.click(screen.getByRole('button', { name: /^Context/ }))
    expect(screen.getByLabelText('Audio transcript').textContent).toBe(mocks.capture.transcript)
    fireEvent.click(screen.getByRole('button', { name: 'Clear audio context' }))
    expect(mocks.capture.clear).toHaveBeenCalledOnce()
  })

  it('shows recoverable audio errors without removing the text-based AI surface', () => {
    mocks.capture.status = 'error'
    mocks.capture.error = 'Microphone access was denied.'
    render(<CopilotWorkspace />)
    expect(screen.getByRole('alert').textContent).toBe('Microphone access was denied.')
    expect(screen.getByLabelText('AI panel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }))
    expect(mocks.capture.start).toHaveBeenCalledExactlyOnceWith('mic')
  })

  it('explains privacy limits and links to appearance settings', () => {
    render(<CopilotWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }))
    expect(screen.getByText(/does not hide the process or guarantee undetectability/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Change app name and icon' }).getAttribute('href')).toBe('/settings#appearance')
    fireEvent.click(screen.getByRole('button', { name: 'Close privacy details' }))
    expect(screen.queryByRole('region', { name: 'Privacy and desktop controls' })).toBeNull()
  })
})
