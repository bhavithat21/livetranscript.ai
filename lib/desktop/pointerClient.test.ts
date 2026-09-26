// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPointerClient, type NativePointerState, type PointerBridge } from './pointerClient'
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function setup(initial: Partial<NativePointerState> = {}) {
  let native: NativePointerState = { locked: false, revision: 0, shortcutAvailable: true, trayAvailable: true, ...initial }
  let changed: () => void = () => {}
  const off = vi.fn()
  const bridge: PointerBridge = {
    read: vi.fn(async () => ({ ...native })),
    set: vi.fn(async locked => { native = { ...native, locked, revision: native.revision + 1 }; changed() }),
    listen: vi.fn(async callback => { changed = callback; return off }),
  }
  const client = createPointerClient(bridge, 1000)
  const unsubscribe = client.subscribe(() => {})
  return { client, bridge, off, unsubscribe, event: (locked: boolean) => { native = { ...native, locked, revision: native.revision + 1 }; changed() } }
}
afterEach(() => vi.useRealTimers())
describe('native pointer state client', () => {
  it('shares a single native subscription and releases timers on unmount', async () => {
    vi.useFakeTimers(); const t = setup(); const second = t.client.subscribe(() => {}); await flush()
    expect(t.bridge.listen).toHaveBeenCalledTimes(1)
    t.unsubscribe(); expect(t.off).not.toHaveBeenCalled(); second(); expect(t.off).toHaveBeenCalledTimes(1)
    const count = vi.mocked(t.bridge.read).mock.calls.length
    await vi.advanceTimersByTimeAsync(5000); expect(t.bridge.read).toHaveBeenCalledTimes(count)
  })
  it('enables only after recovery is confirmed and uses the native result', async () => {
    const t = setup(); await flush(); await t.client.enable(); await flush()
    expect(t.bridge.set).toHaveBeenCalledWith(true); expect(t.client.getSnapshot().locked).toBe(true)
    await t.client.disable(); await flush(); expect(t.client.getSnapshot().locked).toBe(false); t.unsubscribe()
  })
  it('refuses enable without a shortcut or tray', async () => {
    const t = setup({ shortcutAvailable: false, trayAvailable: false }); await flush(); await t.client.enable()
    expect(t.bridge.set).not.toHaveBeenCalled(); expect(t.client.getSnapshot().error).toContain('no recovery'); t.unsubscribe()
  })
  it('permits tray-only recovery without advertising a registered shortcut', async () => {
    const t = setup({ shortcutAvailable: false }); await flush(); await t.client.enable(); await flush()
    expect(t.client.getSnapshot()).toMatchObject({ locked: true, shortcutAvailable: false, trayAvailable: true }); t.unsubscribe()
  })
  it('reflects native shortcut/tray events without a polling delay', async () => {
    const t = setup(); await flush(); t.event(true); await flush(); expect(t.client.getSnapshot().locked).toBe(true)
    t.event(false); await flush(); expect(t.client.getSnapshot().locked).toBe(false); t.unsubscribe()
  })
  it('does not optimistically mark an unsuccessful OS operation as enabled', async () => {
    const t = setup(); await flush(); vi.mocked(t.bridge.set).mockRejectedValueOnce(new Error('OS refusal'))
    await t.client.enable(); await flush(); expect(t.client.getSnapshot()).toMatchObject({ locked: false, busy: false })
    expect(t.client.getSnapshot().error).toContain('Could not complete'); t.unsubscribe()
  })
  it('allows recovery of a legacy lock but blocks newly enabling it', async () => {
    const t = setup(); await flush(); vi.mocked(t.bridge.read).mockResolvedValue({ legacy: true, locked: true })
    await t.client.refresh(); await t.client.enable(); expect(t.bridge.set).not.toHaveBeenCalled()
    await t.client.disable(); expect(t.bridge.set).toHaveBeenCalledWith(false); await flush(); t.unsubscribe()
  })
  it('ignores stale state read before a mutation and re-reads afterward', async () => {
    const t = setup(); await flush()
    let release: (value: NativePointerState) => void = () => {}
    vi.mocked(t.bridge.read).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    void t.client.refresh(); await t.client.enable()
    release({ locked: false, revision: 0, shortcutAvailable: true, trayAvailable: true }); await flush()
    expect(t.client.getSnapshot().locked).toBe(true); t.unsubscribe()
  })
  it('cleans up a listener that finishes registering after unmount', async () => {
    const off = vi.fn(); let release: (off: () => void) => void = () => {}
    const bridge: PointerBridge = { read: async () => ({ locked: false, revision: 0, shortcutAvailable: true, trayAvailable: true }), set: async () => {}, listen: () => new Promise(resolve => { release = resolve }) }
    const client = createPointerClient(bridge); const unsubscribe = client.subscribe(() => {}); unsubscribe(); release(off); await flush()
    expect(off).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed state instead of making controls available', async () => {
    const t = setup(); vi.mocked(t.bridge.read).mockResolvedValue({ locked: false, revision: NaN, shortcutAvailable: true, trayAvailable: true });
    await flush(); await t.client.refresh(); expect(t.client.getSnapshot().revision).toBe(0); t.unsubscribe()
  })
})
