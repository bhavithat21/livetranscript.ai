import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummaryRow } from '@/app/(app)/session-actions'

const mocks = vi.hoisted(() => ({ rename: vi.fn(), remove: vi.fn(), share: vi.fn(), revoke: vi.fn(), push: vi.fn(), refresh: vi.fn(), clipboard: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/app/(app)/session-actions', () => ({ renameSession: mocks.rename, deleteSession: mocks.remove, createShare: mocks.share, revokeShare: mocks.revoke }))
import { SessionActions } from './SessionActions'
import { SessionCard } from './SessionCard'

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.rename.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue(undefined)
  mocks.revoke.mockResolvedValue(undefined)
  mocks.share.mockResolvedValue({ url: '/s/test-link' })
  mocks.clipboard.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector<HTMLElement>('[autofocus]')?.focus() }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)

function setup() { return render(<SessionActions id="session-1" title="Architecture review" shared={false} transcript="A real saved conversation." />) }
function session(): SessionSummaryRow { return { id: 'session-1', title: 'Architecture review', durationSeconds: 62, createdAt: new Date('2026-09-22T10:00:00Z'), shareToken: null, shareExpiresAt: null, summary: { summary: 'Decisions and next steps.' } } }

describe('saved transcript actions', () => {
  it('keeps an invalid or failed rename open and saves explicitly after recovery', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename transcript' }))
    const field = screen.getByLabelText('Transcript title')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Enter a title')
    mocks.rename.mockRejectedValueOnce(new Error('offline'))
    fireEvent.change(field, { target: { value: 'Updated review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be saved'))
    expect((field as HTMLInputElement).value).toBe('Updated review')
    fireEvent.click(await screen.findByRole('button', { name: 'Save title' }))
    await screen.findByRole('heading', { name: 'Updated review' })
    expect(mocks.rename).toHaveBeenLastCalledWith('session-1', 'Updated review')
    expect(screen.getByRole('status').textContent).toBe('Title saved')
  })

  it('cancel and IME composition never save a draft', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename transcript' }))
    const field = screen.getByLabelText('Transcript title')
    fireEvent.change(field, { target: { value: 'Draft' } })
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(mocks.rename).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Architecture review' })).toBeTruthy()
    expect(mocks.rename).not.toHaveBeenCalled()
  })

  it('does not create a share link when opening options and supports manual copy after clipboard failure', async () => {
    mocks.clipboard.mockRejectedValueOnce(new Error('clipboard unavailable'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Share transcript' }))
    expect(mocks.share).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Link expires after' }), { target: { value: '168' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Copy it from the field'))
    expect(mocks.share).toHaveBeenCalledWith('session-1', 168)
    expect((screen.getByLabelText('Share link') as HTMLInputElement).value).toMatch(/\/s\/test-link$/)
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeTruthy()
  })

  it('keeps a live link available after revoke failure and removes it only on success', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Share transcript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await screen.findByLabelText('Share link')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Stop sharing' }) as HTMLButtonElement).disabled).toBe(false))
    mocks.revoke.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('link may still work'))
    expect(screen.getByLabelText('Share link')).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Stop sharing' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    await waitFor(() => expect(screen.queryByLabelText('Share link')).toBeNull())
    expect(screen.getByRole('status').textContent).toContain('Sharing stopped')
  })

  it('opens a real confirmation before deletion and supports keeping the transcript', () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Delete transcript' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Delete transcript?' })
    expect(dialog.textContent).toContain('Architecture review')
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep transcript' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('keeps a failed deletion recoverable and prevents duplicate pending requests', async () => {
    let reject!: (error: Error) => void
    mocks.remove.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete transcript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deleting…' }))
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(mocks.push).not.toHaveBeenCalled()
    await act(async () => reject(new Error('offline')))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('could not be deleted')
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'))
  })

  it('retains a library card after deletion fails instead of optimistic data loss', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('offline'))
    render(<SessionCard session={session()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Architecture review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be deleted'))
    expect(screen.getByRole('heading', { name: 'Architecture review' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep transcript' }))
    expect(screen.getByRole('link', { name: 'Open Architecture review' })).toBeTruthy()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
