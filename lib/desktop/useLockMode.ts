'use client'
import { useSyncExternalStore } from 'react'
import { isTauri } from '@/lib/audio/useNativeCapture'
import { createPointerClient, initialPointerStatus, type NativePointerState } from './pointerClient'

// Native state is authoritative. No CSS pointer-events trick can pass clicks to
// another application. A browser has no subscription and cannot enable this.
const client = createPointerClient({
  read: async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    try { return await invoke<NativePointerState>('get_pointer_state') }
    catch { return { legacy: true as const, locked: await invoke<boolean>('get_lock_mode') } }
  },
  set: async enabled => {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_lock_mode', { enabled })
  },
  listen: async (changed, failed) => {
    const { listen } = await import('@tauri-apps/api/event')
    const offChanged = await listen('pointer-mode-changed', changed)
    try {
      const offError = await listen<string>('pointer-mode-error', event => failed(event.payload))
      return () => { offChanged(); offError() }
    } catch (error) { offChanged(); throw error }
  },
})
const noSubscribe = () => () => {}
const serverSnapshot = () => initialPointerStatus

export function useLockMode() {
  const available = isTauri()
  const status = useSyncExternalStore(available ? client.subscribe : noSubscribe, available ? client.getSnapshot : serverSnapshot, serverSnapshot)
  return { ...status, available, canEnable: available && status.ready && status.supported && (status.shortcutAvailable || status.trayAvailable),
    enable: available ? client.enable : async () => {}, disable: available ? client.disable : async () => {},
    toggle: available ? client.toggle : async () => {}, clearError: client.clearError }
}
