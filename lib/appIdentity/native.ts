import { ICON_SIZE, iconRgba, type AppIcon } from './icons'

export type NativeIdentityResult = 'browser' | 'applied' | 'macos-title'
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Native image resources are released, including denied permission paths. */
export async function applyNativeIdentity(name: string, icon: AppIcon): Promise<NativeIdentityResult> {
  if (!isDesktopRuntime()) return 'browser'
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  await currentWindow.setTitle(name)
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return 'macos-title'
  const image = icon.kind === 'preset' && icon.id === 'default'
    ? await (await import('@tauri-apps/api/app')).defaultWindowIcon()
    : await (await import('@tauri-apps/api/image')).Image.new(await iconRgba(icon), ICON_SIZE, ICON_SIZE)
  if (image) {
    try { await currentWindow.setIcon(image) } finally { await image.close() }
  }
  return 'applied'
}
