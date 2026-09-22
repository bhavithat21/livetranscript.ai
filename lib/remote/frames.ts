/** A bounded, ordered JPEG framing protocol for RTCDataChannel. No pending queue. */
export const MAX_FRAME_BYTES = 524_288
export const MAX_FRAME_CHUNK_BYTES = 16_384
export const FRAME_HEADER_BYTES = 16
export const FRAME_ASSEMBLY_TIMEOUT_MS = 2_000
export const MAX_REMOTE_IMAGE_DIMENSION = 4_096
export const MAX_REMOTE_IMAGE_PIXELS = 4_194_304
const MAGIC = 0x4c545246 // LTRF
const PAYLOAD_BYTES = MAX_FRAME_CHUNK_BYTES - FRAME_HEADER_BYTES

export function toFrameBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  // Older Tauri webviews deserialize raw channel bytes as numeric arrays.
  if (Array.isArray(value) && value.length <= MAX_FRAME_BYTES && value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    return new Uint8Array(value)
  }
  return null
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
}

/** Inspect JPEG headers before allocating a decoded bitmap. Native frames are
 * much smaller; these limits also contain malformed or modified peer traffic. */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > MAX_FRAME_BYTES || !isJpeg(bytes)) return null
  let offset = 2
  let dimensions: { width: number; height: number } | null = null
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) return null
    const marker = bytes[offset++]
    // Standalone markers cannot occur in this pre-scan header area except TEM.
    if (marker === 0x01) continue
    if (marker === 0 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      if (dimensions || length < 8) return null
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const components = bytes[offset + 7]
      if (![8, 12].includes(bytes[offset + 2]) || components < 1 || components > 4 || length !== 8 + 3 * components ||
        !width || !height || width > MAX_REMOTE_IMAGE_DIMENSION || height > MAX_REMOTE_IMAGE_DIMENSION || width * height > MAX_REMOTE_IMAGE_PIXELS) return null
      dimensions = { width, height }
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2]
      if (!dimensions || components < 1 || components > 4 || length !== 6 + 2 * components) return null
      return dimensions
    }
    offset += length
  }
  return null
}

export interface FrameChannel {
  readonly readyState: string
  readonly bufferedAmount: number
  send(data: ArrayBuffer): void
}

/** A slow connection drops the newest frame instead of retaining stale screens. */
export function sendFrame(channel: FrameChannel, value: unknown, frameId: number): boolean {
  const frame = toFrameBytes(value)
  if (!frame || frame.length > MAX_FRAME_BYTES || !isJpeg(frame) || !Number.isInteger(frameId) || frameId < 1 || frameId > 0xffffffff) return false
  if (channel.readyState !== 'open' || channel.bufferedAmount > MAX_FRAME_BYTES) return false
  try {
    for (let offset = 0; offset < frame.length; offset += PAYLOAD_BYTES) {
      const length = Math.min(PAYLOAD_BYTES, frame.length - offset)
      const packet = new Uint8Array(FRAME_HEADER_BYTES + length)
      const header = new DataView(packet.buffer)
      header.setUint32(0, MAGIC)
      header.setUint32(4, frameId)
      header.setUint32(8, frame.length)
      header.setUint32(12, offset)
      packet.set(frame.subarray(offset, offset + length), FRAME_HEADER_BYTES)
      channel.send(packet.buffer)
    }
    return true
  } catch {
    return false
  }
}

export class FrameAssembler {
  private active: { id: number; bytes: Uint8Array; offset: number; startedAt: number } | null = null
  private lastId = 0
  constructor(private readonly now: () => number = Date.now) {}

  clear(): void { this.active = null }

  reset(): void { this.clear(); this.lastId = 0 }

  push(value: unknown): Uint8Array | null {
    const packet = toFrameBytes(value)
    const now = this.now()
    if (this.active && now - this.active.startedAt > FRAME_ASSEMBLY_TIMEOUT_MS) this.clear()
    if (!packet || packet.length <= FRAME_HEADER_BYTES || packet.length > MAX_FRAME_CHUNK_BYTES) {
      this.clear()
      return null
    }
    const header = new DataView(packet.buffer, packet.byteOffset, FRAME_HEADER_BYTES)
    const magic = header.getUint32(0)
    const id = header.getUint32(4)
    const total = header.getUint32(8)
    const offset = header.getUint32(12)
    const payload = packet.subarray(FRAME_HEADER_BYTES)
    if (magic !== MAGIC || !id || total < 4 || total > MAX_FRAME_BYTES || offset + payload.length > total) {
      this.clear()
      return null
    }
    if (offset === 0) {
      if (id <= this.lastId) return null
      this.lastId = id
      this.active = { id, bytes: new Uint8Array(total), offset: 0, startedAt: now }
    }
    const active = this.active
    if (!active || active.id !== id || active.bytes.length !== total || active.offset !== offset) {
      this.clear()
      return null
    }
    active.bytes.set(payload, offset)
    active.offset += payload.length
    if (active.offset !== total) return null
    this.clear()
    return isJpeg(active.bytes) ? active.bytes : null
  }
}
