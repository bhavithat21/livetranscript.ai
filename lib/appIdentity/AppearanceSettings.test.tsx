import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from './AppearanceSettings'
import { AppIdentityEffects } from './AppIdentityEffects'
import type { AppIcon } from './icons'
import { Wordmark } from '@/components/nav/Wordmark'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), native: vi.fn(), pathname: '/settings' }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('./native', () => ({ applyNativeIdentity: mocks.native }))
vi.mock('./icons', async (original) => ({ ...await original<typeof import('./icons')>(), prepareCustomIcon: mocks.prepare }))

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
  vi.clearAllMocks()
  mocks.native.mockResolvedValue('browser')
  mocks.pathname = '/settings'
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mount() { return render(<><AppIdentityEffects /><AppearanceSettings /><Wordmark /></>) }

describe('appearance workflow', () => {
  it('saves a name and icon across the header, title, favicon and a new mount, then resets both', async () => {
    const first = mount()
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: '  Project Atlas  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(document.title).toBe('Project Atlas')
    expect(localStorage.getItem('lt.appName')).toBe('Project Atlas')
    expect(screen.getByText(/Name updated. Saved on this device/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(document.querySelector('link[data-lt-app-icon]')?.getAttribute('href')).toContain('data:image/svg+xml')
    expect(JSON.parse(localStorage.getItem('lt.appIcon')!)).toEqual({ kind: 'preset', id: 'terminal' })
    expect(screen.getByRole('button', { name: /Terminal/ }).getAttribute('aria-pressed')).toBe('true')
    first.unmount()
    mount()
    expect((screen.getByLabelText('App name') as HTMLInputElement).value).toBe('Project Atlas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset appearance' }))
    expect(document.title).toBe('LiveTranscript')
    expect(document.querySelector('link[data-lt-app-icon]')).toBeNull()
    expect(localStorage.getItem('lt.appName')).toBeNull()
    expect(localStorage.getItem('lt.appIcon')).toBeNull()
    await waitFor(() => expect(mocks.native).toHaveBeenLastCalledWith('LiveTranscript', { kind: 'preset', id: 'default' }))
  })

  it('keeps invalid names and uploads from overwriting the saved appearance and focuses the correction', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter an app name')
    expect(document.activeElement).toBe(screen.getByLabelText('App name'))
    expect(localStorage.getItem('lt.appName')).toBeNull()
    mocks.prepare.mockRejectedValue(new Error('Choose a PNG or JPEG image.'))
    const input = screen.getByLabelText('Upload an icon')
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })] } })
    await screen.findByText('Choose a PNG or JPEG image.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input)
    expect(localStorage.getItem('lt.appIcon')).toBeNull()
  })

  it('does not allow a canceled image decode to replace a later preset choice', async () => {
    let resolveUpload!: (icon: AppIcon) => void
    mocks.prepare.mockReturnValue(new Promise<AppIcon>((resolve) => { resolveUpload = resolve }))
    mount()
    fireEvent.change(screen.getByLabelText('Upload an icon'), { target: { files: [new File(['image'], 'icon.png', { type: 'image/png' })] } })
    expect(screen.getByText('Preparing icon…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }))
    fireEvent.click(screen.getByRole('button', { name: 'Notebook' }))
    await act(async () => resolveUpload({ kind: 'preset', id: 'orbit' }))
    expect(JSON.parse(localStorage.getItem('lt.appIcon')!)).toEqual({ kind: 'preset', id: 'notebook' })
    expect(screen.queryByText('Preparing icon…')).toBeNull()
  })

  it('shows a truthful session-only status if browser storage is full', () => {
    mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Temporary notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(document.title).toBe('Temporary notes')
    expect(screen.getByText(/Browser storage is unavailable/)).toBeTruthy()
  })

  it('reports a denied native update while preserving the usable in-app appearance', async () => {
    mocks.native.mockRejectedValue(new Error('permission denied'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }))
    await screen.findByText(/Update or restart the desktop app/)
    expect(JSON.parse(localStorage.getItem('lt.appIcon')!).id).toBe('orbit')
  })
})
