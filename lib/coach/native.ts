import type { FrameSource } from './screen'
import { hashText } from './validation'

export type NativeDisplay = { id: string; name: string; width: number; height: number }
export function nativeAvailable(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke<T>(command, args) }
  catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure)
    if (/not found|unknown command/i.test(message)) throw new Error('This installed desktop app is too old for screen sharing. Install LiveTranscript 0.1.10 or newer, then quit and reopen the app.')
    throw new Error(message)
  }
}
export async function nativeDisplays(): Promise<NativeDisplay[]> {
  if (!nativeAvailable()) return []
  return invoke<NativeDisplay[]>('coach_displays')
}
export async function nativeFrameSource(displayId: string, signal?: AbortSignal): Promise<FrameSource> {
  const requestId = crypto.randomUUID()
  if (signal?.aborted) throw new Error('Screen selection cancelled.')
  const cancel = () => { void invoke('coach_stop', { leaseId: requestId }).catch(() => {}) }
  const starting = invoke<{ leaseId: string }>('coach_start', { displayId, approved: true, requestId })
  signal?.addEventListener('abort', cancel, { once: true })
  let leaseId: string
  try { ({ leaseId } = await starting) } finally { signal?.removeEventListener('abort', cancel) }
  if (signal?.aborted) { await invoke('coach_stop', { leaseId }).catch(() => {}); throw new Error('Screen selection cancelled.') }
  let stopped = false
  return {
    async signal() {
      if (stopped) return null
      const sample = await invoke<{ pixels: number[]; width: number; height: number }>('coach_sample', { leaseId })
      if (sample.pixels.length !== sample.width * sample.height || sample.pixels.length > 640 * 640) throw new Error('Invalid native screen sample')
      const pixels = Uint8Array.from(sample.pixels)
      let key = ''
      for (let i = 0; i < pixels.length; i += 8192) key += String.fromCharCode(...pixels.subarray(i, i + 8192))
      return { pixels, width: sample.width, height: sample.height, fingerprint: hashText(key) }
    },
    async image() {
      if (stopped) return null
      const buffer = await invoke<ArrayBuffer>('coach_grab', { leaseId })
      const bytes = new Uint8Array(buffer)
      if (bytes.length > 4_400_000 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid native screenshot')
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192))
      return `data:image/jpeg;base64,${btoa(binary)}`
    },
    async stop() { if (!stopped) { stopped = true; await invoke('coach_stop', { leaseId }).catch(() => {}) } },
  }
}

/** Explicit user action only; never opens a permission dialog on startup. */
export async function openScreenRecordingSettings(): Promise<void> {
  if (!nativeAvailable()) return
  await invoke('coach_open_screen_settings')
}
