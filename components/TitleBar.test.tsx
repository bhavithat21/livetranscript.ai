import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ desktop: true, toggle: vi.fn(), minimize: vi.fn(async () => {}), maximize: vi.fn(async () => {}), close: vi.fn(async () => {}), locked: false, canEnable: true, shortcut: true, error: null as string | null }))
vi.mock('@/lib/audio/useNativeCapture', () => ({ isTauri: () => mocks.desktop }))
vi.mock('@/lib/desktop/useLockMode', () => ({ useLockMode: () => ({ locked: mocks.locked, canEnable: mocks.canEnable, busy: false, shortcutAvailable: mocks.shortcut, trayAvailable: true, error: mocks.error, toggle: mocks.toggle, clearError: vi.fn() }) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ minimize: mocks.minimize, toggleMaximize: mocks.maximize, close: mocks.close }) }))
import { TitleBar } from './TitleBar'
beforeEach(() => { mocks.desktop = true; mocks.locked = false; mocks.canEnable = true; mocks.shortcut = true; mocks.error = null; vi.clearAllMocks() })
afterEach(cleanup)
it('renders nothing and no controls in a normal browser', () => { mocks.desktop = false; render(<TitleBar />); expect(screen.queryByRole('toolbar')).toBeNull() })
it('exposes pass-through in the desktop global title bar and retains window controls', () => {
  render(<TitleBar />); fireEvent.click(screen.getByRole('button', { name: 'Pass through mouse clicks' })); expect(mocks.toggle).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Minimize' })).toBeDefined(); expect(screen.getByRole('button', { name: 'Maximize' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Pass through mouse clicks' }).closest('[data-tauri-drag-region]')).toBeNull()
})
it('shows a recovery path rather than a mouse-only unlock instruction', () => {
  mocks.locked = true; mocks.shortcut = false; render(<TitleBar />)
  expect(screen.getByRole('status').textContent).toContain('Tray'); expect(screen.getByRole('button', { name: 'Pass through mouse clicks' }).getAttribute('aria-pressed')).toBe('true')
})
it('does not offer enable when no recovery is available', () => {
  mocks.canEnable = false; render(<TitleBar />); expect((screen.getByRole('button', { name: 'Pass through mouse clicks' }) as HTMLButtonElement).disabled).toBe(true)
})
it('shows a native operation error instead of silently swallowing it', () => {
  mocks.error = 'Cannot enable pass-through'; render(<TitleBar />); expect(screen.getByRole('alert').textContent).toContain(mocks.error)
})
