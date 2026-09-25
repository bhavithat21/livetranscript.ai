'use client'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { DEFAULT_APP_NAME, useAppIdentity } from './useAppIdentity'
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
  const lastCustomName = useRef<string | null>(null)
  const routeTitle = useRef(DEFAULT_APP_NAME)

  useEffect(() => {
    if (name === DEFAULT_APP_NAME) {
      if (lastCustomName.current && document.title === lastCustomName.current) document.title = routeTitle.current
      lastCustomName.current = null
      return
    }

    // Next can stream route metadata after the pathname effect has run. Keep
    // custom titles authoritative, but retain that metadata for an honest reset.
    if (document.title !== name && document.title !== lastCustomName.current) routeTitle.current = document.title || DEFAULT_APP_NAME
    lastCustomName.current = name
    document.title = name
    const observer = new MutationObserver((records) => {
      const titleChanged = records.some((record) => record.target.nodeName === 'TITLE'
        || record.target.parentNode?.nodeName === 'TITLE'
        || [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeName === 'TITLE'))
      if (!titleChanged || document.title === name) return
      routeTitle.current = document.title || DEFAULT_APP_NAME
      document.title = name
    })
    observer.observe(document.head, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [name, pathname])

  useEffect(() => {
    document.querySelector('link[data-lt-app-icon]')?.remove()
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = icon.kind === 'custom' || icon.id === 'default' ? 'image/png' : 'image/svg+xml'
    link.href = iconSource(icon)
    link.dataset.ltAppIcon = 'true'
    document.head.appendChild(link)
    // Keep the chosen favicon last if a later metadata chunk adds the framework
    // favicon. The browser default is the canonical caption-mark artwork.
    const observer = new MutationObserver(() => {
      const icons = document.head.querySelectorAll('link[rel~="icon"]')
      if (icons.item(icons.length - 1) !== link) document.head.appendChild(link)
    })
    observer.observe(document.head, { childList: true })
    return () => { observer.disconnect(); link.remove() }
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
