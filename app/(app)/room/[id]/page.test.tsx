import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), clipboard: vi.fn(), room: vi.fn(), capture: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'swift-otter-4821' }), useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: mocks.back }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/room/useRoom', () => ({ useRoom: mocks.room }))
vi.mock('@/lib/audio/useMicStream', () => ({ useMicStream: mocks.capture }))
vi.mock('@/lib/transcript/useThemeMode', () => ({ useThemeMode: () => ({ theme: 'light', toggle: vi.fn() }) }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Light theme</span> }))
vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <span>Navigation</span> }))
vi.mock('@/components/copilot/CopilotPanel', () => ({ CopilotPanel: () => null }))
import RoomPage from './page'

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.clipboard.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } })
})
afterEach(cleanup)

describe('meeting lobby', () => {
  it('explains the text-only room and waits for an explicit join', () => {
    render(<RoomPage />)
    expect(screen.getByText(/shares the transcript, not the call audio/)).toBeTruthy()
    expect(screen.getByText('Not transcribing')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join meeting' })).toBeTruthy()
    expect(mocks.room).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('keeps a failed clipboard copy recoverable without claiming success', async () => {
    mocks.clipboard.mockRejectedValueOnce(new Error('clipboard unavailable'))
    render(<RoomPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }))
    const field = await screen.findByLabelText('Invitation link')
    expect((field as HTMLInputElement).value).toContain('/room/swift-otter-4821')
    expect(screen.getByRole('status').textContent).toContain('Select and copy')
    expect(screen.queryByRole('button', { name: 'Invite link copied' })).toBeNull()
  })

  it('validates a different invitation before navigation and preserves the entered value', async () => {
    render(<RoomPage />)
    const field = screen.getByLabelText('Joining a different meeting?')
    fireEvent.change(field, { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(mocks.push).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('valid meeting ID')
    expect(document.activeElement).toBe(field)
    expect((field as HTMLInputElement).value).toBe('bad')
    fireEvent.change(field, { target: { value: 'https://example.com/room/calm-falcon-1234?source=invite#join' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/room/calm-falcon-1234?join=1'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
