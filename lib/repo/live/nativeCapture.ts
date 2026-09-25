// Native transport only; no inference, filesystem access or remote control.
export type NativeDisplay = { id: string; name: string; width: number; height: number }
export type NativeLease = { token: string; display: NativeDisplay; expiresAfterMs: number }
export function isNativeRepoHost(): boolean { return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window }
function display(value: unknown): NativeDisplay {
  if (!value || typeof value !== 'object') throw new Error('Invalid native display')
  const d = value as Record<string, unknown>
  if (typeof d.id !== 'string' || !/^\d{1,20}$/.test(d.id) || typeof d.name !== 'string' || d.name.length > 500 || typeof d.width !== 'number' || !Number.isInteger(d.width) || d.width < 1 || d.width > 20000 || typeof d.height !== 'number' || !Number.isInteger(d.height) || d.height < 1 || d.height > 20000) throw new Error('Invalid native display metadata')
  return { id: d.id, name: d.name, width: d.width, height: d.height }
}
export async function nativeDisplays(): Promise<NativeDisplay[]> {
  if (!isNativeRepoHost()) throw new Error('Use the installed desktop application for native display capture')
  const { invoke } = await import('@tauri-apps/api/core')
  const data = await invoke<unknown>('repo_capture_displays')
  if (!Array.isArray(data) || data.length > 32) throw new Error('Invalid native display list')
  return data.map(display)
}
export async function startNativeDisplay(displayId: string): Promise<NativeLease> {
  const { invoke } = await import('@tauri-apps/api/core')
  const result = await invoke<Record<string, unknown>>('repo_capture_start', { displayId, consent: true })
  if (!result || typeof result.token !== 'string' || !/^[a-f0-9-]{36}$/.test(result.token) || result.expiresAfterMs !== 3600000) throw new Error('Invalid native capture lease')
  return { token: result.token, display: display(result.display), expiresAfterMs: result.expiresAfterMs }
}
export async function stopNativeDisplay(token: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('repo_capture_stop', { token })
}
export async function nativeDisplayFrame(token: string, force = false): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core')
  const frame = await invoke<Record<string, unknown> | null>('repo_capture_frame', { token, force })
  if (frame === null) return null
  if (frame.mime !== 'image/jpeg' || !Array.isArray(frame.bytes) || frame.bytes.length < 3 || frame.bytes.length > 2000000 || !frame.bytes.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('Invalid native JPEG frame')
  const bytes = Uint8Array.from(frame.bytes)
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid JPEG signature')
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read native frame')); reader.readAsDataURL(new Blob([bytes], { type: 'image/jpeg' })) })
}
