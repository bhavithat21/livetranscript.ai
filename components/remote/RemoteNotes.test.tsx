import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialRemoteSnapshot, type RemoteSessionClient, type RemoteSnapshot } from '@/lib/remote/client'
import { RemoteNotes } from './RemoteNotes'

const connected: RemoteSnapshot = {
  ...initialRemoteSnapshot, status: 'connected', role: 'controller',
  display: { id: '1', name: 'Laptop', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true },
}

function setup(snapshot: RemoteSnapshot = connected) {
  const sendNote = vi.fn().mockReturnValue(true)
  const clearNotes = vi.fn()
  const client = { sendNote, clearNotes } as unknown as RemoteSessionClient
  return { ...render(<RemoteNotes client={client} snapshot={snapshot} />), sendNote, clearNotes, client }
}

afterEach(cleanup)

describe('visible session notes', () => {
  it('sends only after an explicit submit and works while input control is off', () => {
    const session = setup()
    const field = screen.getByLabelText('Note to the laptop owner') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'Explain the failure before making a change.' } })
    expect(session.sendNote).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }))
    expect(session.sendNote).toHaveBeenCalledWith('Explain the failure before making a change.')
    expect(field.value).toBe('')
    expect(screen.getByRole('status').textContent).toContain('Note sent')
  })

  it('keeps a failed draft for retry and refuses blank/control-character messages', () => {
    const session = setup()
    session.sendNote.mockReturnValueOnce(false)
    const field = screen.getByLabelText('Note to the laptop owner') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'Please review this path.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }))
    expect(field.value).toBe('Please review this path.')
    expect(screen.getByRole('status').textContent).toContain('not sent')
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }))
    expect(field.value).toBe('')
    fireEvent.change(field, { target: { value: 'bad\u0001note' } })
    fireEvent.submit(field.closest('form')!)
    expect(session.sendNote).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('control characters')
    fireEvent.change(field, { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'Send note' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders sender identities and markup as plain visible text', () => {
    const text = '<img src=x onerror=alert(1)>\n**An ordinary note**'
    const session = setup({ ...connected, notes: [
      { id: 'host:1', sender: 'host', senderName: 'Host AAAAAA', text },
      { id: 'helper:1', sender: 'controller', senderName: 'Helper BBBBBB', text: 'Thanks.' },
    ] })
    expect(screen.getByText('Host AAAAAA')).toBeTruthy()
    expect(screen.getByText('Helper BBBBBB · You')).toBeTruthy()
    expect(screen.getByRole('log').textContent).toContain(text)
    expect(session.container.querySelector('img')).toBeNull()
    expect(session.container.querySelector('strong')).toBeNull()
  })

  it('clears only this device and empties the draft with an honest explanation', () => {
    const session = setup({ ...connected, notes: [{ id: 'host:1', sender: 'host', senderName: 'Host AAAAAA', text: 'A note' }] })
    const field = screen.getByLabelText('Note to the laptop owner') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'An unsent draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear on this device' }))
    expect(session.clearNotes).toHaveBeenCalledOnce()
    expect(session.sendNote).not.toHaveBeenCalled()
    expect(field.value).toBe('')
    expect(screen.getByRole('status').textContent).toContain('other participant keeps their copy')
  })

  it('keeps sending disabled until the host has finished opening the approved session', () => {
    setup({ ...connected, display: null })
    fireEvent.change(screen.getByLabelText('Note to the laptop owner'), { target: { value: 'A pending draft' } })
    expect((screen.getByRole('button', { name: 'Send note' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Waiting for the approved connection')
  })
})
