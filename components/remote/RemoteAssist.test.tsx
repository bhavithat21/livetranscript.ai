import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteSnapshot } from '@/lib/remote/client'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(), displays: vi.fn(), createHost: vi.fn(), join: vi.fn(),
  approve: vi.fn(), deny: vi.fn(), setControl: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
  emit: undefined as undefined | ((snapshot: RemoteSnapshot) => void),
}))

vi.mock('@/components/nav/HomeMenu', () => ({ HomeMenu: () => <a href="/library">Home</a> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme</span> }))
vi.mock('@/lib/remote/native', async (original) => ({
  ...await original<typeof import('@/lib/remote/native')>(),
  getRemoteCapabilities: mocks.capabilities, getRemoteDisplays: mocks.displays,
}))
vi.mock('@/lib/remote/client', async (original) => {
  const actual = await original<typeof import('@/lib/remote/client')>()
  return {
    ...actual,
    RemoteSessionClient: class {
      constructor(options: { onChange: (snapshot: RemoteSnapshot) => void }) { mocks.emit = options.onChange }
      createHost = mocks.createHost
      join = mocks.join
      approve = mocks.approve
      deny = mocks.deny
      setControl = mocks.setControl
      stop = mocks.stop
      dispose = mocks.dispose
      releaseInputs = vi.fn()
    },
  }
})

import { initialRemoteSnapshot } from '@/lib/remote/client'
import { RemoteAssist } from './RemoteAssist'

const display = { id: '17', name: 'Laptop display', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 2, isPrimary: true }
const desktop = { supported: true, protocolVersion: 1, platform: 'macos', stopShortcut: 'Cmd+Option+Shift+X', stopShortcutRegistered: true }

function update(patch: Partial<RemoteSnapshot>) {
  act(() => { mocks.emit?.({ ...initialRemoteSnapshot, ...patch }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.capabilities.mockResolvedValue({ ...desktop, supported: false, platform: 'browser' })
  mocks.displays.mockResolvedValue([display])
  for (const operation of [mocks.createHost, mocks.join, mocks.approve, mocks.deny, mocks.setControl, mocks.stop]) operation.mockResolvedValue(undefined)
  window.history.replaceState({}, '', '/remote')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('remote assistance user flow', () => {
  it('offers the desktop download in a browser and never pretends it can share OS apps', async () => {
    render(<RemoteAssist />)
    fireEvent.click(screen.getByRole('button', { name: 'Share this laptop' }))
    expect(await screen.findByRole('link', { name: 'Get the desktop app' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Create invitation/ })).toBeNull()
    expect(mocks.displays).not.toHaveBeenCalled()
    expect(mocks.createHost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Control a laptop' }))
    expect(screen.getByLabelText('Invitation')).toBeTruthy()
  })

  it('focuses invalid invitation feedback without making a connection request', async () => {
    render(<RemoteAssist />)
    const invitation = screen.getByLabelText('Invitation')
    fireEvent.change(invitation, { target: { value: 'this is not an invitation' } })
    fireEvent.click(screen.getByRole('button', { name: /Request connection/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(invitation.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(invitation)
    expect(mocks.join).not.toHaveBeenCalled()
  })

  it('recovers from display discovery failure and uses the selected display', async () => {
    mocks.capabilities.mockResolvedValue(desktop)
    mocks.displays.mockRejectedValueOnce(new Error('Display service unavailable')).mockResolvedValueOnce([display])
    render(<RemoteAssist />)
    fireEvent.click(screen.getByRole('button', { name: 'Share this laptop' }))
    expect(await screen.findByText('Display service unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    const create = await screen.findByRole('button', { name: /Create invitation/ })
    fireEvent.click(create)
    await waitFor(() => expect(mocks.createHost).toHaveBeenCalledWith('17'))
    expect(mocks.displays).toHaveBeenCalledTimes(2)
  })

  it('keeps host viewing approval separate from control and permits immediate session stop', async () => {
    mocks.capabilities.mockResolvedValue(desktop)
    render(<RemoteAssist />)
    await waitFor(() => expect(mocks.displays).toHaveBeenCalled())
    const helper = { clientId: 'c_0123456789abcdef01234567', code: 'Helper 234567' }
    const waiting: Partial<RemoteSnapshot> = { status: 'waiting', role: 'host', invite: 'private-invite', pending: [helper], display }
    update(waiting)
    expect(screen.queryByDisplayValue('private-invite')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Allow mouse and keyboard' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Approve viewing' }))
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith(helper.clientId))
    expect(mocks.setControl).not.toHaveBeenCalled()
    update({ ...waiting, status: 'connected', pending: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Allow mouse and keyboard' }))
    await waitFor(() => expect(mocks.setControl).toHaveBeenLastCalledWith(true))
    update({ ...waiting, status: 'connected', pending: [], controlEnabled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Turn control off' }))
    await waitFor(() => expect(mocks.setControl).toHaveBeenLastCalledWith(false))
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(mocks.stop).toHaveBeenCalledWith('Stopped from this device')
    update({ role: 'host', status: 'ended', endedReason: 'Stopped from this device' })
    expect(screen.queryByRole('region', { name: 'Laptop session' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Connection setup' })).toBeTruthy()
  })

  it('removes invitation fragments and clears the entered secret after requesting approval', async () => {
    window.history.replaceState({}, '', '/remote#invite=private.token')
    render(<RemoteAssist />)
    const invitation = screen.getByLabelText('Invitation') as HTMLInputElement
    await waitFor(() => expect(invitation.value).toBe('private.token'))
    expect(window.location.hash).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /Request connection/ }))
    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith('private.token'))
    update({ status: 'waiting', role: 'controller', helperCode: 'Helper ABCDEF' })
    expect(screen.getByText('Helper ABCDEF')).toBeTruthy()
    expect(screen.queryByDisplayValue('private.token')).toBeNull()
    update({ status: 'ended', role: 'controller', endedReason: 'Owner ended this session' })
    expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('')
  })

  it('does not advertise an emergency shortcut the operating system failed to register', async () => {
    mocks.capabilities.mockResolvedValue({ ...desktop, stopShortcutRegistered: false })
    render(<RemoteAssist />)
    await waitFor(() => expect(mocks.displays).toHaveBeenCalled())
    update({ status: 'connected', role: 'host', display })
    expect(screen.getByText(/global stop shortcut is unavailable/)).toBeTruthy()
    expect(screen.queryByText(desktop.stopShortcut)).toBeNull()
    expect(screen.getByRole('button', { name: 'End session' })).toBeTruthy()
  })

  it('disposes the active connection on navigation and ignores late device enumeration', async () => {
    let resolve: ((value: typeof desktop) => void) | undefined
    mocks.capabilities.mockReturnValue(new Promise<typeof desktop>((done) => { resolve = done }))
    const { unmount } = render(<RemoteAssist />)
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled())
    unmount()
    await act(async () => { resolve?.(desktop); await Promise.resolve() })
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    expect(mocks.displays).not.toHaveBeenCalled()
  })
})
