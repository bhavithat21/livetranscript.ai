'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { useAppIdentity } from './useAppIdentity'
import { iconSource } from './icons'
import { applyNativeIdentity } from './native'

let nativeMessage: string | null = null
const subscribers = new Set<() => void>()
function subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify) } }
function publish(message: string | null) { nativeMessage = message; subscribers.forEach((notify) => notify()) }
export function useNativeIdentityMessage() { return useSyncExternalStore(subscribe, () => nativeMessage, () => null) }

/** Mounted once in the root shell, including pages where navigation is hidden. */
export function AppIdentityEffects() {
  const { name, icon } = useAppIdentity()
  const pathname = usePathname()
  useEffect(() => { document.title = name }, [name, pathname])

  useEffect(() => {
    document.querySelector('link[data-lt-app-icon]')?.remove()
    if (icon.kind === 'preset' && icon.id === 'default') return
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = icon.kind === 'custom' ? 'image/png' : 'image/svg+xml'
    link.href = iconSource(icon)
    link.dataset.ltAppIcon = 'true'
    document.head.appendChild(link)
    return () => link.remove()
  }, [icon, pathname])

  useEffect(() => {
    let current = true
    nativeQueue = nativeQueue.then(async () => {
      if (!current) return
      try {
        const result = await applyNativeIdentity(name, icon)
        if (current) publish(result === 'macos-title' ? 'Window title updated. The macOS Dock icon changes with a rebuilt installer.' : null)
      } catch {
        if (current) publish('Appearance saved in the app. Update or restart the desktop app to apply the window title and icon.')
      }
    })
    return () => { current = false }
  }, [name, icon])
  return null
}

// Ordered updates prevent an older image decode overwriting a newer choice.
let nativeQueue: Promise<void> = Promise.resolve()
