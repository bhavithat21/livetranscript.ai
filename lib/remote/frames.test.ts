import { describe, expect, it, vi } from 'vitest'
import { FRAME_ASSEMBLY_TIMEOUT_MS, FRAME_HEADER_BYTES, FrameAssembler, MAX_FRAME_BYTES, MAX_FRAME_CHUNK_BYTES, readJpegDimensions, sendFrame, toFrameBytes } from './frames'

function jpeg(length = 50_000): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes.set([0xff, 0xd8])
  bytes.set([0xff, 0xd9], length - 2)
  return bytes
}

function packets(frame: Uint8Array, id = 1): ArrayBuffer[] {
  const sent: ArrayBuffer[] = []
  expect(sendFrame({ readyState: 'open', bufferedAmount: 0, send: (packet) => sent.push(packet) }, frame, id)).toBe(true)
  return sent
}

function jpegHeader(width = 1280, height = 720): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0,
    0xff, 0xd9,
  ])
}

describe('JPEG dimensions before bitmap allocation', () => {
  it('accepts bounded baseline and progressive dimensions without decoding pixels', () => {
    expect(readJpegDimensions(jpegHeader())).toEqual({ width: 1280, height: 720 })
    const progressive = jpegHeader(1, 1)
    progressive[3] = 0xc2
    expect(readJpegDimensions(progressive)).toEqual({ width: 1, height: 1 })
  })

  it('rejects oversized dimensions, pixel counts, invalid lengths and truncated headers', () => {
    expect(readJpegDimensions(jpegHeader(4097, 10))).toBeNull()
    expect(readJpegDimensions(jpegHeader(3000, 2000))).toBeNull()
    expect(readJpegDimensions(jpegHeader(0, 720))).toBeNull()
    expect(readJpegDimensions(jpegHeader().slice(0, 13))).toBeNull()
    const invalid = jpegHeader()
    invalid[5] = 255
    expect(readJpegDimensions(invalid)).toBeNull()
    expect(readJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })

  it('rejects a second frame header before decoding and skips bounded metadata segments', () => {
    const frame = jpegHeader()
    const duplicate = new Uint8Array([...frame.slice(0, 21), ...frame.slice(2)])
    expect(readJpegDimensions(duplicate)).toBeNull()
    const metadata = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...frame.slice(2)])
    expect(readJpegDimensions(metadata)).toEqual({ width: 1280, height: 720 })
  })
})

describe('remote screen transport', () => {
  it('round-trips a maximum sized JPEG in chunks below the WebRTC portability limit', () => {
    const frame = jpeg(MAX_FRAME_BYTES)
    const chunks = packets(frame)
    expect(chunks.length).toBeGreaterThan(30)
    expect(chunks.every((chunk) => chunk.byteLength <= MAX_FRAME_CHUNK_BYTES)).toBe(true)
    const assembler = new FrameAssembler()
    const completed = chunks.map((chunk) => assembler.push(chunk)).filter(Boolean)
    expect(completed).toEqual([frame])
  })

  it('drops frames under backpressure without creating a pending send queue', () => {
    const send = vi.fn()
    expect(sendFrame({ readyState: 'open', bufferedAmount: MAX_FRAME_BYTES + 1, send }, jpeg(), 1)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(sendFrame({ readyState: 'closed', bufferedAmount: 0, send }, jpeg(), 1)).toBe(false)
    expect(sendFrame({ readyState: 'open', bufferedAmount: 0, send }, jpeg(MAX_FRAME_BYTES + 1), 1)).toBe(false)
  })

  it('rejects oversized claimed allocation and oversized chunks', () => {
    const assembler = new FrameAssembler()
    const [packet] = packets(jpeg())
    new DataView(packet).setUint32(8, 0xffffffff)
    expect(assembler.push(packet)).toBeNull()
    expect(assembler.push(new ArrayBuffer(MAX_FRAME_CHUNK_BYTES + 1))).toBeNull()
    expect(assembler.push(new ArrayBuffer(FRAME_HEADER_BYTES))).toBeNull()
  })

  it('abandons missing, replayed, out-of-order and expired frame fragments', () => {
    let now = 0
    const assembler = new FrameAssembler(() => now)
    const chunks = packets(jpeg())
    expect(assembler.push(chunks[0])).toBeNull()
    expect(assembler.push(chunks[2])).toBeNull()
    expect(assembler.push(chunks[1])).toBeNull()
    expect(chunks.map((chunk) => assembler.push(chunk)).filter(Boolean)).toEqual([])
    const fresh = packets(jpeg(), 2)
    assembler.push(fresh[0])
    now = FRAME_ASSEMBLY_TIMEOUT_MS + 1
    expect(fresh.slice(1).map((chunk) => assembler.push(chunk)).filter(Boolean)).toEqual([])
    const valid = packets(jpeg(8), 3)
    expect(assembler.push(valid[0])).toEqual(jpeg(8))
    expect(assembler.push(valid[0])).toBeNull()
  })

  it('resets sequence tracking for a new session and handles offset typed arrays', () => {
    const assembler = new FrameAssembler()
    const [packet] = packets(jpeg(8))
    const padded = new Uint8Array(packet.byteLength + 10)
    padded.set(new Uint8Array(packet), 5)
    expect(assembler.push(padded.subarray(5, -5))).toEqual(jpeg(8))
    assembler.reset()
    expect(assembler.push(packet)).toEqual(jpeg(8))
    expect(toFrameBytes([255, 216, 255, 217])).toEqual(jpeg(4))
    expect(toFrameBytes([255, -1, 999])).toBeNull()
  })
})
