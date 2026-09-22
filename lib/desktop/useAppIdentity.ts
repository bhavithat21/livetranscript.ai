'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { IDENTITY_PRESETS, useAppIdentity as useCanonicalIdentity } from '@/lib/appIdentity/useAppIdentity'
import { isDesktopRuntime } from '@/lib/appIdentity/native'

export { IDENTITY_PRESETS }
const subscribeToRuntime = () => () => {}
const serverDesktopAvailable = () => false

/** Compatibility adapter for the compact desktop preset picker. */
export function useAppIdentity() {
  const available = useSyncExternalStore(subscribeToRuntime, isDesktopRuntime, serverDesktopAvailable)
  const { name, save } = useCanonicalIdentity()
  const matched = IDENTITY_PRESETS.find((preset) => preset.title === name)
  const current = matched?.id ?? 'custom'
  const presets = matched ? IDENTITY_PRESETS : [...IDENTITY_PRESETS, { id: 'custom', label: name, title: name }]
  const setIdentity = useCallback((id: string) => {
    const preset = IDENTITY_PRESETS.find((entry) => entry.id === id)
    if (preset) save(preset.title)
  }, [save])
  return { available, current, presets, setIdentity }
}
