import type { FrameSource } from './screen'
import { hashText } from './validation'

export type NativeDisplay = { id: string; name: string; width: number; height: number }
export function nativeAvailable(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}
export async function nativeDisplays(): Promise<NativeDisplay[]> {
  if (!nativeAvailable()) return []
  return invoke<NativeDisplay[]>('coach_displays')
}
export async function nativeFrameSource(displayId: string): Promise<FrameSource> {
  const { leaseId } = await invoke<{ leaseId: string }>('coach_start', { displayId, approved: true })
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
