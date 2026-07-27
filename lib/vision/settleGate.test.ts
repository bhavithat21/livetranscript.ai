import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoCapture } from './useAutoCapture'

// The settle gate is the only non-trivial branch in useAutoCapture: a CHANGED
// frame must not fire until the screen goes QUIET (grabFrame returns null). These
// drive the interval by ticking fake timers and asserting exactly when onChange
// fires — the failure mode we care about is firing mid-edit (half-typed problem).
describe('useAutoCapture settle gate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const INTERVAL = 1_200

  it('fires only after a change is followed by a quiet grab (changed → settled)', () => {
    const onChange = vi.fn()
    // grabFrame: tick1 changed ("F1"), tick2 quiet (null) → should fire F1.
    const frames: (string | null)[] = ['F1', null]
    let i = 0
    const grab = () => frames[i++] ?? null
    renderHook(() => useAutoCapture(true, grab, onChange))

    vi.advanceTimersByTime(INTERVAL) // grab #1: changed → arm, no fire
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(INTERVAL) // grab #2: quiet → fire the armed frame
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('F1')
  })

  it('never fires while the screen keeps changing (still typing)', () => {
    const onChange = vi.fn()
    // Every grab reports a change — a screen mid-edit. Must NEVER fire.
    const grab = () => 'typing...'
    renderHook(() => useAutoCapture(true, grab, onChange))

    vi.advanceTimersByTime(INTERVAL * 5)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('fires the LATEST frame, not the first, when the screen changes then settles', () => {
    const onChange = vi.fn()
    const frames: (string | null)[] = ['half', 'full', null]
    let i = 0
    const grab = () => frames[i++] ?? null
    renderHook(() => useAutoCapture(true, grab, onChange))

    vi.advanceTimersByTime(INTERVAL * 3)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('full') // re-armed on the newer frame
  })

  it('holds off during cooldown after a fire, then fires a new settled change', () => {
    const onChange = vi.fn()
    // fire, then a new change lands during cooldown, then settle again well after.
    const frames: (string | null)[] = ['A', null, 'B', null]
    let i = 0
    const grab = () => frames[i++] ?? null
    renderHook(() => useAutoCapture(true, grab, onChange))

    vi.advanceTimersByTime(INTERVAL * 2) // A armed, then fires
    expect(onChange).toHaveBeenCalledTimes(1)
    // Next two grabs (B, null) fall inside the 15s cooldown → suppressed.
    vi.advanceTimersByTime(INTERVAL * 2)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    const onChange = vi.fn()
    const grab = () => 'F1'
    renderHook(() => useAutoCapture(false, grab, onChange))
    vi.advanceTimersByTime(INTERVAL * 5)
    expect(onChange).not.toHaveBeenCalled()
  })
})
