import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyNativeIdentity } from './native'

const mocks = vi.hoisted(() => ({
  setTitle: vi.fn(), setIcon: vi.fn(), close: vi.fn(), createImage: vi.fn(), defaultIcon: vi.fn(), rgba: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTitle: mocks.setTitle, setIcon: mocks.setIcon }) }))
vi.mock('@tauri-apps/api/image', () => ({ Image: { new: mocks.createImage } }))
vi.mock('@tauri-apps/api/app', () => ({ defaultWindowIcon: mocks.defaultIcon }))
vi.mock('./icons', async (original) => ({ ...await original<typeof import('./icons')>(), iconRgba: mocks.rgba }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__TAURI_INTERNALS__', {})
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows')
  mocks.createImage.mockResolvedValue({ rid: 4, close: mocks.close })
  mocks.defaultIcon.mockResolvedValue({ rid: 1, close: mocks.close })
  mocks.rgba.mockResolvedValue(new Uint8Array(256 * 256 * 4))
  mocks.setTitle.mockResolvedValue(undefined)
  mocks.setIcon.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('native app appearance', () => {
  it('sets a native title and icon using bounded RGBA, then releases the resource', async () => {
    await expect(applyNativeIdentity('My workspace', { kind: 'preset', id: 'terminal' })).resolves.toBe('applied')
    expect(mocks.setTitle).toHaveBeenCalledWith('My workspace')
    expect(mocks.createImage).toHaveBeenCalledWith(expect.any(Uint8Array), 256, 256)
    expect(mocks.setIcon).toHaveBeenCalledWith(expect.objectContaining({ rid: 4 }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('restores the bundled icon and still closes the resource when a native permission is denied', async () => {
    mocks.setIcon.mockRejectedValue(new Error('denied'))
    await expect(applyNativeIdentity('LiveTranscript', { kind: 'preset', id: 'default' })).rejects.toThrow('denied')
    expect(mocks.defaultIcon).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('reports title-only changes on macOS rather than claiming a Dock icon update', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh; Intel Mac OS X')
    await expect(applyNativeIdentity('Notes', { kind: 'preset', id: 'notebook' })).resolves.toBe('macos-title')
    expect(mocks.setTitle).toHaveBeenCalledWith('Notes')
    expect(mocks.setIcon).not.toHaveBeenCalled()
    expect(mocks.createImage).not.toHaveBeenCalled()
  })

  it('does not invoke the desktop bridge in a browser', async () => {
    vi.unstubAllGlobals()
    await expect(applyNativeIdentity('Notes', { kind: 'preset', id: 'notebook' })).resolves.toBe('browser')
    expect(mocks.setTitle).not.toHaveBeenCalled()
  })
})
