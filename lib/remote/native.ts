import type { RemoteInput } from './protocol'
import { MAX_FRAME_BYTES, toFrameBytes } from './frames'

export type RemoteDisplay = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
  isPrimary: boolean
}

export type RemoteCapabilities = {
  supported: boolean
  protocolVersion: number
  platform: string
  stopShortcut: string
  stopShortcutRegistered?: boolean
}

export type RemoteLease = {
  leaseId: string
  display: RemoteDisplay
  heartbeatMs: number
  expiresAfterMs: number
  maxFrameBytes: number
}

export type RemoteNative = {
  capabilities(): Promise<RemoteCapabilities>
  displays(): Promise<RemoteDisplay[]>
  start(displayId: string, onFrame: (jpeg: Uint8Array) => void): Promise<RemoteLease>
  heartbeat(leaseId: string): Promise<void>
  setControl(leaseId: string, enabled: boolean): Promise<void>
  input(leaseId: string, event: RemoteInput): Promise<void>
  stop(leaseId: string): Promise<void>
  onStopped(callback: (event: { leaseId: string; reason: string }) => void): Promise<() => void>
}

export function isRemoteDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getRemoteCapabilities(): Promise<RemoteCapabilities> {
  if (!isRemoteDesktop()) return { supported: false, protocolVersion: 1, platform: 'browser', stopShortcut: '', stopShortcutRegistered: false }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<RemoteCapabilities>('remote_assist_capabilities')
  } catch {
    throw new Error('Update the desktop app to use remote assistance.')
  }
}

export async function getRemoteDisplays(): Promise<RemoteDisplay[]> {
  if (!isRemoteDesktop()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<RemoteDisplay[]>('remote_assist_displays')
}

export const remoteNative: RemoteNative = {
  capabilities: getRemoteCapabilities,
  displays: getRemoteDisplays,
  async start(displayId, onFrame) {
    const { invoke, Channel } = await import('@tauri-apps/api/core')
    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (value) => {
      const bytes = toFrameBytes(value)
      if (bytes && bytes.length <= MAX_FRAME_BYTES) onFrame(bytes)
    }
    return invoke<RemoteLease>('remote_assist_start', { displayId, onFrame: channel })
  },
  async heartbeat(leaseId) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('remote_assist_heartbeat', { leaseId })
  },
  async setControl(leaseId, enabled) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('remote_assist_set_control', { leaseId, enabled })
  },
  async input(leaseId, event) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('remote_assist_input', { leaseId, event })
  },
  async stop(leaseId) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('remote_assist_stop', { leaseId })
  },
  async onStopped(callback) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<{ leaseId: string; reason: string }>('remote-assist-stopped', ({ payload }) => callback(payload))
  },
}
