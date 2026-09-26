// Isolated test transport. It does not simulate OS mouse delivery.
import type { NativePointerState } from '../../lib/desktop/pointerClient'
let state: NativePointerState = { locked: false, revision: 0, shortcutAvailable: true, trayAvailable: true }
const callbacks = new Map<string, Set<(event: { payload: unknown }) => void>>()
export const calls: { command: string; args: unknown }[] = []
export async function invoke(command: string, args?: { enabled?: boolean }) {
  calls.push({ command, args })
  if (command === 'get_pointer_state') return { ...state }
  if (command === 'set_lock_mode') { nativeChange(Boolean(args?.enabled)); return }
  if (command === 'get_lock_mode') return state.locked
  throw new Error('Unsupported fixture command')
}
export function nativeChange(locked: boolean) {
  state = { ...state, locked, revision: state.revision + 1 }
  callbacks.get('pointer-mode-changed')?.forEach(fn => fn({ payload: { ...state } }))
}
export async function listen(name: string, fn: (event: { payload: unknown }) => void) {
  if (!callbacks.has(name)) callbacks.set(name, new Set())
  callbacks.get(name)!.add(fn)
  return () => { callbacks.get(name)?.delete(fn) }
}
export const getCurrentWindow = () => ({ minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {} })
