import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteSessionClient } from '@/lib/remote/client'
import { RemoteScreen, type RemoteScreenHandle } from './RemoteScreen'

// The decoder is mocked, but use a bounded, structurally valid JPEG header so
// the pre-decode dimension check remains active in these lifecycle tests.
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 208, 5, 0, 3,
  1, 17, 0, 2, 17, 0, 3, 17, 0,
  0xff, 0xda, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 0xff, 0xd9,
])
let drawImage: ReturnType<typeof vi.fn>
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> }

function setup(enabled = true) {
  const sendInput = vi.fn().mockReturnValue(true)
  const releaseInputs = vi.fn()
  const client = { sendInput, releaseInputs } as unknown as RemoteSessionClient
  const screenRef = createRef<RemoteScreenHandle>()
  const result = render(<RemoteScreen client={client} enabled={enabled} screenRef={screenRef} />)
  return { ...result, client, sendInput, releaseInputs, screenRef }
}

async function receiveFrame(screenRef: React.RefObject<RemoteScreenHandle | null>) {
  await act(async () => { screenRef.current!.draw(jpeg); await Promise.resolve() })
  return screen.getByRole('application') as HTMLCanvasElement
}

beforeEach(() => {
  drawImage = vi.fn()
  bitmap = { width: 1280, height: 720, close: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('remote screen input and frame lifecycle', () => {
  it('shows frames in view-only mode without sending keyboard or text input', async () => {
    const session = setup(false)
    const canvas = await receiveFrame(session.screenRef)
    expect(canvas.tabIndex).toBe(-1)
    fireEvent.keyDown(canvas, { key: 'a', code: 'KeyA' })
    fireEvent.keyUp(canvas, { key: 'a', code: 'KeyA' })
    expect(session.sendInput).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Send text' })).toBeNull()
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('releases inputs and exits the application keyboard region on Escape', async () => {
    const session = setup()
    const canvas = await receiveFrame(session.screenRef)
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'Control', code: 'ControlLeft' })
    fireEvent.keyDown(canvas, { key: 'Escape', code: 'Escape' })
    expect(document.activeElement).not.toBe(canvas)
    expect(session.releaseInputs).toHaveBeenCalled()
    expect(session.sendInput.mock.calls.some(([input]) => input.key === 'Escape')).toBe(false)
    const count = session.releaseInputs.mock.calls.length
    session.unmount()
    expect(session.releaseInputs.mock.calls.length).toBeGreaterThan(count)
    expect(session.screenRef.current).toBeNull()
  })

  it('releases the original key when modifier changes alter KeyboardEvent.key', async () => {
    const session = setup()
    const canvas = await receiveFrame(session.screenRef)
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'Shift', code: 'ShiftLeft' })
    fireEvent.keyDown(canvas, { key: 'A', code: 'KeyA', shiftKey: true })
    fireEvent.keyUp(canvas, { key: 'Shift', code: 'ShiftLeft' })
    fireEvent.keyUp(canvas, { key: 'a', code: 'KeyA' })
    expect(session.sendInput).toHaveBeenCalledWith({ type: 'key', key: 'A', down: false })
    expect(session.sendInput).not.toHaveBeenCalledWith({ type: 'key', key: 'a', down: false })
  })

  it('suppresses local page scrolling only for a focused, controllable screen and normalizes line deltas', async () => {
    const session = setup()
    const canvas = await receiveFrame(session.screenRef)
    const beforeFocus = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 3, deltaMode: 1 })
    canvas.dispatchEvent(beforeFocus)
    expect(beforeFocus.defaultPrevented).toBe(false)
    expect(session.sendInput).not.toHaveBeenCalled()
    canvas.focus()
    const remoteScroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 3, deltaMode: 1 })
    canvas.dispatchEvent(remoteScroll)
    expect(remoteScroll.defaultPrevented).toBe(true)
    expect(session.sendInput).toHaveBeenCalledWith(expect.objectContaining({ type: 'scroll', deltaY: expect.any(Number) }))
    const sent = session.sendInput.mock.calls.at(-1)![0]
    expect(sent.deltaY).toBeGreaterThan(0)
  })

  it('keeps unsent text for retry and clears it only after transport accepts it', async () => {
    const session = setup()
    const textarea = screen.getByLabelText('Send text to the focused field') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'const total = 2;' } })
    session.sendInput.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }))
    expect(textarea.value).toBe('const total = 2;')
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }))
    expect(textarea.value).toBe('')
    expect(session.sendInput).toHaveBeenLastCalledWith({ type: 'text', text: 'const total = 2;' })
    expect(await screen.findByText('Text sent to the laptop’s focused field.')).toBeTruthy()
  })

  it('rejects oversized JPEG dimensions before allocating a browser decoder and accepts the next valid frame', async () => {
    const session = setup(false)
    const oversized = new Uint8Array(jpeg)
    oversized[9] = 0xff
    oversized[10] = 0xff
    act(() => { session.screenRef.current!.draw(oversized) })
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(screen.getByText(/invalid screen frame was ignored/)).toBeTruthy()
    await receiveFrame(session.screenRef)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
  })

  it('bounds decoding to one image and keeps only the newest waiting frame', async () => {
    const resolvers: ((value: typeof bitmap) => void)[] = []
    const requestedSizes: number[] = []
    vi.stubGlobal('createImageBitmap', vi.fn((blob: Blob) => {
      requestedSizes.push(blob.size)
      return new Promise<typeof bitmap>((resolve) => resolvers.push(resolve))
    }))
    const session = setup(false)
    const older = { ...bitmap, close: vi.fn() }
    const newer = { ...bitmap, close: vi.fn() }
    const middle = new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xfe, 0, 3, 65, ...jpeg.slice(2)])
    const latest = new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xfe, 0, 4, 66, 67, ...jpeg.slice(2)])
    act(() => {
      session.screenRef.current!.draw(jpeg)
      session.screenRef.current!.draw(middle)
      session.screenRef.current!.draw(latest)
    })
    expect(requestedSizes).toEqual([jpeg.length])
    await act(async () => { resolvers[0](older); await Promise.resolve() })
    expect(requestedSizes).toEqual([jpeg.length, latest.length])
    await act(async () => { resolvers[1](newer); await Promise.resolve() })
    expect(drawImage).toHaveBeenLastCalledWith(newer, 0, 0)
    expect(older.close).toHaveBeenCalledTimes(1)
    expect(newer.close).toHaveBeenCalledTimes(1)
  })

  it('discards a late decode after unmount and reports failed frames without crashing', async () => {
    const decode = vi.fn()
    let finish: ((value: typeof bitmap) => void) | undefined
    decode.mockImplementationOnce(() => Promise.reject(new Error('Invalid JPEG')))
    decode.mockImplementationOnce(() => new Promise<typeof bitmap>((resolve) => { finish = resolve }))
    vi.stubGlobal('createImageBitmap', decode)
    const session = setup(false)
    await act(async () => { session.screenRef.current!.draw(jpeg); await Promise.resolve() })
    await waitFor(() => expect(screen.getByText(/could not be displayed/)).toBeTruthy())
    act(() => { session.screenRef.current!.draw(jpeg) })
    session.unmount()
    await act(async () => { finish?.(bitmap); await Promise.resolve() })
    expect(drawImage).not.toHaveBeenCalled()
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })
})
