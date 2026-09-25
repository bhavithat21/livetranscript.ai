import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_ICON, DEFAULT_ICON_DATA_URL, iconSource, parseStoredIcon, prepareCustomIcon, validateIconFile } from './icons'

function pngHeader(width = 256, height = 256) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
function dataUrl(bytes: Uint8Array) { return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}` }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('local icon validation', () => {
  it('uses the canonical web caption mark byte-for-byte for the default browser icon', () => {
    const shipped = readFileSync('public/brand/icon.png')
    expect(Buffer.from(DEFAULT_ICON_DATA_URL.split(',')[1], 'base64')).toEqual(shipped)
    expect(iconSource(DEFAULT_ICON)).toBe(DEFAULT_ICON_DATA_URL)
  })

  it('checks image signatures and dimensions before invoking a browser decoder', () => {
    expect(() => validateIconFile(pngHeader(), 'image/png')).not.toThrow()
    expect(() => validateIconFile(pngHeader(12000, 12000), 'image/png')).toThrow(/4096/)
    expect(() => validateIconFile(pngHeader(0), 'image/png')).toThrow(/4096/)
    expect(() => validateIconFile(pngHeader(), 'image/jpeg')).toThrow(/valid PNG or JPEG/)
    expect(() => validateIconFile(new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/png')).toThrow(/valid PNG or JPEG/)
    expect(() => validateIconFile(new Uint8Array(2 * 1024 * 1024 + 1), 'image/png')).toThrow(/2 MB/)
  })

  it('accepts JPEG SOF dimensions and rejects truncated or oversized frames', () => {
    const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 1, 0, 1, 0, 1, 1, 17, 0])
    expect(() => validateIconFile(jpeg, 'image/jpeg')).not.toThrow()
    expect(() => validateIconFile(jpeg.slice(0, 9), 'image/jpeg')).toThrow(/valid/)
    jpeg[9] = 32
    expect(() => validateIconFile(jpeg, 'image/jpeg')).toThrow(/4096/)
  })

  it('only restores bounded 256px PNG data, never remote URLs or arbitrary SVG', () => {
    expect(parseStoredIcon(JSON.stringify({ kind: 'custom', dataUrl: dataUrl(pngHeader()) })).kind).toBe('custom')
    for (const source of ['https://example.com/image.png', 'data:image/svg+xml,<svg/>', dataUrl(pngHeader(1024)), 'data:image/png;base64,AAAA']) {
      expect(parseStoredIcon(JSON.stringify({ kind: 'custom', dataUrl: source }))).toEqual(DEFAULT_ICON)
    }
    expect(parseStoredIcon(JSON.stringify({ kind: 'preset', id: 'missing' }))).toEqual(DEFAULT_ICON)
  })

  it('rasterizes an image to a centered square and revokes the temporary URL', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl(pngHeader()))
    const createObjectURL = vi.fn(() => 'blob:local-preview')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('Image', class {
      naturalWidth = 512
      naturalHeight = 256
      onload: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    })
    const file = new File([pngHeader(512, 256)], 'icon.png', { type: 'image/png' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => pngHeader(512, 256).buffer })
    const icon = await prepareCustomIcon(file)
    expect(icon.kind).toBe('custom')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 64, 256, 128)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview')
  })

  it('rejects a broken decoder result and releases its temporary URL', async () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:broken', revokeObjectURL })
    vi.stubGlobal('Image', class {
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
    })
    const file = new File([pngHeader()], 'broken.png', { type: 'image/png' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => pngHeader().buffer })
    await expect(prepareCustomIcon(file)).rejects.toThrow(/could not be opened/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:broken')
  })
})
