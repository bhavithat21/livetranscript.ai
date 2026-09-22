import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_NAME, useAppIdentity } from './useAppIdentity'
import { useAppIdentity as useDesktopIdentity } from '@/lib/desktop/useAppIdentity'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

describe('app name preference migration', () => {
  it('reads existing unquoted names and shares edits with other mounted consumers', () => {
    localStorage.setItem('lt.appName', 'Interview workspace')
    const first = renderHook(useAppIdentity)
    const second = renderHook(useAppIdentity)
    expect(first.result.current.name).toBe('Interview workspace')
    act(() => first.result.current.save('  My notes  '))
    expect(second.result.current.name).toBe('My notes')
    expect(localStorage.getItem('lt.appName')).toBe('My notes')
    act(() => second.result.current.reset())
    expect(first.result.current.name).toBe(DEFAULT_APP_NAME)
    expect(localStorage.getItem('lt.appName')).toBeNull()
  })

  it('migrates the old desktop preset once and does not resurrect it after reset', () => {
    localStorage.setItem('lt.identity', 'reader')
    const canonical = renderHook(useAppIdentity)
    const desktop = renderHook(useDesktopIdentity)
    expect(canonical.result.current.name).toBe('Reader')
    expect(localStorage.getItem('lt.identity')).toBeNull()
    act(() => desktop.result.current.setIdentity('notes'))
    expect(canonical.result.current.name).toBe('Notes')
    act(() => canonical.result.current.save('Project Atlas'))
    expect(desktop.result.current.current).toBe('custom')
    expect(desktop.result.current.presets.at(-1)?.label).toBe('Project Atlas')
    act(() => canonical.result.current.setIcon({ kind: 'preset', id: 'terminal' }))
    expect(canonical.result.current.isCustom).toBe(true)
    act(() => canonical.result.current.reset())
    expect(canonical.result.current.name).toBe(DEFAULT_APP_NAME)
    expect(canonical.result.current.icon).toEqual({ kind: 'preset', id: 'default' })
    expect(localStorage.getItem('lt.appIcon')).toBeNull()
    canonical.unmount()
    expect(renderHook(useAppIdentity).result.current.name).toBe(DEFAULT_APP_NAME)
  })

  it('prefers an existing canonical name to the former desktop preset', () => {
    localStorage.setItem('lt.appName', 'Personal workspace')
    localStorage.setItem('lt.identity', 'reader')
    const identity = renderHook(useAppIdentity)
    expect(identity.result.current.name).toBe('Personal workspace')
    expect(localStorage.getItem('lt.identity')).toBeNull()
  })

  it('normalizes control characters and ignores malformed stored icons', () => {
    localStorage.setItem('lt.appName', '\u0000  My\nWorkspace  ')
    localStorage.setItem('lt.appIcon', '{"kind":"custom","dataUrl":"https://example.com/icon.png"}')
    const identity = renderHook(useAppIdentity)
    expect(identity.result.current.name).toBe('MyWorkspace')
    expect(identity.result.current.icon).toEqual({ kind: 'preset', id: 'default' })
  })
})
