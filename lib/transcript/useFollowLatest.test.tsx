import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LiveScrollArea } from '@/components/transcript/LiveScrollArea'

let observers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }>
beforeEach(() => {
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback; disconnect = vi.fn(); observe = vi.fn()
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this) }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function resize() { act(() => observers.at(-1)?.callback([], {} as ResizeObserver)) }
function setup(enabled = true, flow = false) {
  const view = render(<LiveScrollArea updateKey="first" enabled={enabled} flow={flow}><p>First speech</p></LiveScrollArea>)
  const el = screen.getByLabelText('Live transcript')
  let height = 1200, client = 200, top = 0
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => client },
    scrollTop: { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(value, height - client)) } },
  })
  const update = (text: string, isEnabled = enabled) => view.rerender(<LiveScrollArea updateKey={text} enabled={isEnabled} flow={flow}><p>{text}</p></LiveScrollArea>)
  return { ...view, el, update, height: (next: number) => { height = next }, client: (next: number) => { client = next } }
}
describe('live edge preference', () => {
  it('lands at the latest speech when initially mounting an already long transcript', () => {
    const { el, update } = setup(); update('Loaded recording'); expect(el.scrollTop).toBe(1000)
  })
  it('never loses follow because an incoming batch is taller than the old near-bottom threshold', () => {
    const { el, height, update } = setup(); update('First final'); height(4800); update('Large finalized burst'); expect(el.scrollTop).toBe(4600)
  })
  it('follows growing interim text even when its utterance identity has not changed', () => {
    const { el, height, update } = setup(); update('utterance-1: hello'); height(1600); update('utterance-1: hello revised words'); expect(el.scrollTop).toBe(1400)
  })
  it('pins after font, wrapping and hidden-tab resize changes with no new ASR event', () => {
    const { el, height, client, update } = setup(); update('First'); height(1700); client(300); resize(); expect(el.scrollTop).toBe(1400)
  })
  it('pauses only for deliberate upward history review and exposes a working resume button', () => {
    const { el, height, update } = setup(); update('First'); fireEvent.wheel(el, { deltaY: -80 }); el.scrollTop = 500; fireEvent.scroll(el)
    height(5000); update('Newest'); expect(el.scrollTop).toBe(500)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest live transcript' })); expect(el.scrollTop).toBe(4800)
    height(6000); update('Next'); expect(el.scrollTop).toBe(5800)
  })
  it('does not yank history during content resize', () => {
    const { el, height, update } = setup(); update('First'); fireEvent.wheel(el, { deltaY: -10 }); el.scrollTop = 200
    height(1800); resize(); expect(el.scrollTop).toBe(200)
  })
  it('resumes when the user scrolls back to the live edge', () => {
    const { el, height, update } = setup(); update('First'); fireEvent.wheel(el, { deltaY: -80 }); el.scrollTop = 400; fireEvent.scroll(el)
    fireEvent.wheel(el, { deltaY: 800 }); el.scrollTop = 1000; fireEvent.scroll(el)
    height(2200); update('New line'); expect(el.scrollTop).toBe(2000)
  })
  it('handles touch and keyboard history review', () => {
    const { el, height, update } = setup(); update('First')
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] }); fireEvent.touchMove(el, { touches: [{ clientY: 180 }] })
    el.scrollTop = 600; height(1800); update('Next'); expect(el.scrollTop).toBe(600)
    fireEvent.keyDown(el, { key: 'End' }); expect(el.scrollTop).toBe(1600)
    fireEvent.keyDown(el, { key: 'PageUp' }); el.scrollTop = 900; height(2200); update('More'); expect(el.scrollTop).toBe(900)
  })
  it('recognizes upward scrollbar drags but not geometry-triggered scroll events', () => {
    const { el, height, update } = setup(); update('First'); height(1800); fireEvent.scroll(el); update('Large burst'); expect(el.scrollTop).toBe(1600)
    fireEvent.pointerDown(el); el.scrollTop = 300; fireEvent.scroll(el); update('Later'); expect(el.scrollTop).toBe(300)
  })
  it('does not mistake text reflow after Jump to latest for another history gesture', () => {
    const { el, height, update } = setup(); update('First'); fireEvent.scroll(el)
    fireEvent.wheel(el, { deltaY: -80 }); el.scrollTop = 400; fireEvent.scroll(el)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest live transcript' })); fireEvent.scroll(el)
    // Browser anchoring shifts the old offset while the enlarged text is laid out.
    height(2500); el.scrollTop = 800; fireEvent.scroll(el); resize()
    expect(el.scrollTop).toBe(2300)
    expect(screen.queryByRole('button', { name: 'Jump to latest live transcript' })).toBeNull()
  })
  it('stops attributing later geometry changes to a released scrollbar pointer', () => {
    const { el, height, update } = setup(); update('First'); fireEvent.scroll(el)
    fireEvent.pointerDown(el); fireEvent.pointerUp(document)
    height(2500); el.scrollTop = 800; fireEvent.scroll(el); resize()
    expect(el.scrollTop).toBe(2300)
  })
  it('keeps archived documents stationary and retains ordinary page scrolling', () => {
    const { el, update } = setup(false, true); update('Archived line'); expect(el.scrollTop).toBe(0); expect(screen.queryByRole('button')).toBeNull()
  })
  it('follows instantly even when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true })); const { el, update } = setup(); update('Latest'); expect(el.scrollTop).toBe(1000)
  })
  it('stops observing on teardown and when follow is disabled', () => {
    const { el, unmount, update, height } = setup(); update('First'); const last = observers.at(-1)!; height(2500); update('Stopped', false); expect(el.scrollTop).toBe(1000); expect(last.disconnect).toHaveBeenCalled(); unmount()
  })
})
