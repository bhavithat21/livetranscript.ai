// Verbatim src-tauri/icons/128x128.png; shared browser/native default artwork.
export const DEFAULT_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAA8UlEQVR42u3SsQ0AMAjAsA7s/ZSR9+ENJOwTosSv7MdZIYEBMAAGwAAYAANgAAyAATAABsAAGAADYAAMgAEwAAbAABgAA2AADIABMAAGwAAYAANgAAyAATAABsAAGAADYAAMgAEwAAbAABgAA2AADIABMAAGwAAYAANgAAyAATAABsAAGAADYAAMgAEwAAbAABgAA2AADIABMAAGwAAYAANgAAyAATAABsAAGMAAEhgAA2AADIABMAAGwAAYAANgAAyAATAABsAAGAADYAAMgAEwAAbAABgAA2AADIABMAAGwAAYAANgAAyAATAABsAA7DCgqQPzl63ULgAAAABJRU5ErkJggg=='

export const ICON_SIZE = 256
export const MAX_ICON_FILE_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_SIDE = 4096
const MAX_DATA_URL_LENGTH = 400_000

export const ICON_PRESETS = [
  { id: 'default', label: 'LiveTranscript' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'orbit', label: 'Orbit' },
] as const
export type IconPresetId = (typeof ICON_PRESETS)[number]['id']
export type AppIcon = { kind: 'preset'; id: IconPresetId } | { kind: 'custom'; dataUrl: string }
export const DEFAULT_ICON: AppIcon = { kind: 'preset', id: 'default' }

// Fixed, local artwork. Custom uploads are decoded and rasterized to PNG;
// SVG uploads and external URLs never enter the preference or native bridge.
const PRESET_SVGS: Record<Exclude<IconPresetId, 'default'>, string> = {
  notebook: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#0f766e"/><rect x="66" y="43" width="135" height="174" rx="13" fill="#fffdf9"/><path d="M91 43v174M113 85h63M113 116h63M113 147h47" fill="none" stroke="#0f766e" stroke-width="10" stroke-linecap="round"/></svg>',
  terminal: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#16151a"/><path d="m55 80 49 48-49 48M127 177h71" fill="none" stroke="#fffdf9" stroke-width="19" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  orbit: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#faf9f7"/><circle cx="128" cy="128" r="69" fill="none" stroke="#0f766e" stroke-width="13"/><ellipse cx="128" cy="128" rx="31" ry="92" transform="rotate(45 128 128)" fill="none" stroke="#0f766e" stroke-width="11"/><circle cx="128" cy="128" r="18" fill="#16151a"/></svg>',
}

export function iconSource(icon: AppIcon): string {
  if (icon.kind === 'custom') return icon.dataUrl
  if (icon.id === 'default') return DEFAULT_ICON_DATA_URL
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PRESET_SVGS[icon.id])}`
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return null
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
    if (length < 2 || offset + length > bytes.length) return null
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return null
      return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] }
    }
    offset += length
  }
  return null
}

export function validateIconFile(bytes: Uint8Array, type: string): void {
  if (bytes.length === 0 || bytes.length > MAX_ICON_FILE_BYTES) throw new Error('Choose an image smaller than 2 MB.')
  const dimensions = type === 'image/png' ? pngDimensions(bytes) : type === 'image/jpeg' ? jpegDimensions(bytes) : null
  if (!dimensions) throw new Error('Choose a valid PNG or JPEG image.')
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_SOURCE_SIDE || dimensions.height > MAX_SOURCE_SIDE) {
    throw new Error('Choose an image no larger than 4096 × 4096 pixels.')
  }
}

export function parseStoredIcon(raw: string): AppIcon {
  try {
    if (raw.length > MAX_DATA_URL_LENGTH + 100) return DEFAULT_ICON
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_ICON
    if ('kind' in value && value.kind === 'preset' && 'id' in value && ICON_PRESETS.some((entry) => entry.id === value.id)) {
      return { kind: 'preset', id: value.id as IconPresetId }
    }
    if ('kind' in value && value.kind === 'custom' && 'dataUrl' in value && typeof value.dataUrl === 'string') {
      const dataUrl = value.dataUrl
      if (dataUrl.length > MAX_DATA_URL_LENGTH || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return DEFAULT_ICON
      const start = 'data:image/png;base64,'.length
      const prefix = atob(dataUrl.slice(start, start + 32))
      const dimensions = pngDimensions(Uint8Array.from(prefix, (character) => character.charCodeAt(0)))
      if (dimensions?.width === ICON_SIZE && dimensions.height === ICON_SIZE) return { kind: 'custom', dataUrl }
    }
  } catch {
    // Malformed local preferences fall back to the shipped icon.
  }
  return DEFAULT_ICON
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(() => { image.src = ''; reject(new Error('Image decoding timed out. Choose another image.')) }, 10_000)
    image.onload = () => { clearTimeout(timer); resolve(image) }
    image.onerror = () => { clearTimeout(timer); reject(new Error('This image could not be opened. Choose another PNG or JPEG.')) }
    image.src = source
  })
}

async function renderIcon(source: string): Promise<HTMLCanvasElement> {
  const image = await loadImage(source)
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_SOURCE_SIDE || image.naturalHeight > MAX_SOURCE_SIDE) {
    throw new Error('Choose an image no larger than 4096 × 4096 pixels.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = ICON_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image editing is unavailable in this browser. Choose a built-in icon.')
  const scale = ICON_SIZE / Math.max(image.naturalWidth, image.naturalHeight)
  const width = Math.round(image.naturalWidth * scale)
  const height = Math.round(image.naturalHeight * scale)
  context.drawImage(image, Math.floor((ICON_SIZE - width) / 2), Math.floor((ICON_SIZE - height) / 2), width, height)
  return canvas
}

export async function prepareCustomIcon(file: File): Promise<AppIcon> {
  if (file.size === 0 || file.size > MAX_ICON_FILE_BYTES) throw new Error('Choose an image smaller than 2 MB.')
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Choose a PNG or JPEG image.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  validateIconFile(bytes, file.type)
  const url = URL.createObjectURL(file)
  try {
    const canvas = await renderIcon(url)
    const icon = parseStoredIcon(JSON.stringify({ kind: 'custom', dataUrl: canvas.toDataURL('image/png') }))
    if (icon.kind !== 'custom') throw new Error('This image could not be saved. Choose another PNG or JPEG.')
    return icon
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function iconRgba(icon: AppIcon): Promise<Uint8Array> {
  const canvas = await renderIcon(iconSource(icon))
  const context = canvas.getContext('2d')!
  return new Uint8Array(context.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data)
}
