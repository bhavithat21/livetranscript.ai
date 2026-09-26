/** One shared state subscription per native window, independent of route mounts. */
export type NativePointerState = {
  locked: boolean
  revision: number
  shortcutAvailable: boolean
  trayAvailable: boolean
}
export type PointerStatus = NativePointerState & { ready: boolean; supported: boolean; busy: boolean; error: string | null }
export type PointerBridge = {
  read: () => Promise<NativePointerState | { legacy: true; locked: boolean }>
  set: (enabled: boolean) => Promise<void>
  listen: (changed: () => void, failed: (error: string) => void) => Promise<() => void>
}
export const initialPointerStatus: PointerStatus = Object.freeze({ locked: false, revision: -1, shortcutAvailable: false, trayAvailable: false, ready: false, supported: false, busy: false, error: null })

export function createPointerClient(bridge: PointerBridge, pollMs = 2000) {
  let status: PointerStatus = initialPointerStatus
  const listeners = new Set<() => void>()
  let generation = 0
  let action = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let stop: (() => void) | undefined
  let reading = false
  let queued = false
  const update = (changes: Partial<PointerStatus>) => {
    status = { ...status, ...changes }
    listeners.forEach(listener => listener())
  }
  async function refresh() {
    if (!listeners.size) return
    if (reading || status.busy) { queued = true; return }
    reading = true
    const token = generation, actionAtRead = action
    try {
      const next = await bridge.read()
      if (token !== generation || actionAtRead !== action || status.busy) return
      if ('legacy' in next) {
        update({ locked: next.locked, ready: true, supported: false, shortcutAvailable: false, trayAvailable: false,
          error: 'Update the desktop app to enable pass-through safely. An existing lock can still be released.' })
      } else if (typeof next.locked === 'boolean' && Number.isSafeInteger(next.revision) && next.revision >= status.revision
        && typeof next.shortcutAvailable === 'boolean' && typeof next.trayAvailable === 'boolean') {
        update({ ...next, ready: true, supported: true })
      } else if (!status.ready) {
        update({ error: 'The desktop app returned an unsupported mouse-input state.' })
      }
    } catch {
      if (token === generation && actionAtRead === action) update({ ready: false, error: 'Cannot read desktop mouse input. Use the tray to restore interaction, then try again.' })
    } finally {
      if (token === generation) {
        reading = false
        if (queued) { queued = false; void refresh() }
      }
    }
  }
  function subscribe(listener: () => void) {
    listeners.add(listener)
    if (listeners.size === 1) {
      const token = ++generation
      reading = false; queued = false
      void bridge.listen(() => { if (token === generation) void refresh() }, () => {
        if (token === generation) { update({ error: 'Mouse input could not be changed. Use Restore mouse interaction in the tray.' }); void refresh() }
      }).then(unlisten => { if (token !== generation) unlisten(); else stop = unlisten }).catch(() => {
        // Polling still reflects native state on shells without the event channel.
      })
      void refresh()
      timer = setInterval(() => void refresh(), pollMs)
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        generation++; clearInterval(timer); timer = undefined
        stop?.(); stop = undefined; queued = false; reading = false
      }
    }
  }
  async function set(enabled: boolean) {
    if (status.busy) return
    if (enabled && (!status.ready || !status.supported || !(status.shortcutAvailable || status.trayAvailable))) {
      update({ error: status.supported ? 'Pass-through is unavailable: no recovery shortcut or tray control is registered.' : 'Update the desktop app before enabling pass-through.' })
      return
    }
    action++
    update({ busy: true, error: null })
    try {
      await bridge.set(enabled)
      // Do not optimistically mark it enabled: read the native state after the
      // OS operation. An unlock may succeed even if restoring stacking failed.
    } catch {
      update({ error: 'Could not complete the mouse-input change. Check the state or use Restore mouse interaction in the tray.' })
    } finally {
      action++; update({ busy: false }); queued = false; void refresh()
    }
  }
  return { getSnapshot: () => status, subscribe, refresh, enable: () => set(true), disable: () => set(false), toggle: () => set(!status.locked), clearError: () => update({ error: null }) }
}
