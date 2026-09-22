import { createElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStoredPreference } from './useStoredPreference'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useStoredPreference', () => {
  it('uses the server fallback and hydrates saved values without a mismatch', async () => {
    const key = 'test.hydration'
    localStorage.setItem(key, JSON.stringify('saved'))
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const onRecoverableError = vi.fn()
    function Preference() {
      const { value } = useStoredPreference(key, 'default')
      return createElement('span', null, value)
    }

    const html = renderToString(createElement(Preference))
    expect(html).toBe('<span>default</span>')
    expect(getItem).not.toHaveBeenCalled()
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    let root: Root | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, createElement(Preference), { onRecoverableError })
      })
      expect(container.textContent).toBe('saved')
      expect(onRecoverableError).not.toHaveBeenCalled()
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps decoded snapshots and update callbacks stable between renders', () => {
    const fallback = { count: 0 }
    localStorage.setItem('test.stable', JSON.stringify({ count: 3 }))
    const { result, rerender } = renderHook(() => useStoredPreference('test.stable', fallback))
    const value = result.current.value
    const update = result.current.setValue
    rerender()
    expect(result.current.value).toBe(value)
    expect(result.current.setValue).toBe(update)
  })

  it('updates all same-tab consumers and applies sequential updates to the latest value', () => {
    const first = renderHook(() => useStoredPreference('test.shared', 0))
    const second = renderHook(() => useStoredPreference('test.shared', 0))
    act(() => {
      first.result.current.setValue((value) => value + 1)
      first.result.current.setValue((value) => value + 1)
    })
    expect(first.result.current.value).toBe(2)
    expect(second.result.current.value).toBe(2)
    expect(localStorage.getItem('test.shared')).toBe('2')
  })

  it('returns fallback values for absent or malformed persisted data', () => {
    const fallback = { ready: false }
    const missing = renderHook(() => useStoredPreference('test.missing', fallback))
    expect(missing.result.current.value).toBe(fallback)
    localStorage.setItem('test.corrupt', '{broken')
    const corrupt = renderHook(() => useStoredPreference('test.corrupt', fallback))
    expect(corrupt.result.current.value).toBe(fallback)
  })

  it('updates session values when storage access is blocked and reports failure', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    const first = renderHook(() => useStoredPreference('test.blocked', 'default'))
    const second = renderHook(() => useStoredPreference('test.blocked', 'default'))
    expect(first.result.current.value).toBe('default')
    act(() => {
      expect(first.result.current.setValue('session')).toBe(false)
    })
    expect(first.result.current.value).toBe('session')
    expect(second.result.current.value).toBe('session')
    act(() => {
      expect(first.result.current.clear()).toBe(false)
    })
    expect(first.result.current.value).toBe('default')
    expect(second.result.current.value).toBe('default')
  })

  it('clears saved data and refreshes all same-tab subscribers', () => {
    localStorage.setItem('test.clear', JSON.stringify('saved'))
    const first = renderHook(() => useStoredPreference('test.clear', 'default'))
    const second = renderHook(() => useStoredPreference('test.clear', 'default'))
    act(() => {
      expect(first.result.current.clear()).toBe(true)
    })
    expect(localStorage.getItem('test.clear')).toBeNull()
    expect(first.result.current.value).toBe('default')
    expect(second.result.current.value).toBe('default')
  })

  it('reacts to cross-tab changes and clear events', () => {
    const { result } = renderHook(() => useStoredPreference('test.remote', 'default'))
    act(() => {
      localStorage.setItem('test.remote', JSON.stringify('remote'))
      window.dispatchEvent(new StorageEvent('storage', { key: 'test.remote', storageArea: localStorage }))
    })
    expect(result.current.value).toBe('remote')
    act(() => {
      localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
    })
    expect(result.current.value).toBe('default')
  })

  it('switches keys without showing or writing the previous key’s value', () => {
    localStorage.setItem('test.modeA', JSON.stringify('first'))
    localStorage.setItem('test.modeB', JSON.stringify('second'))
    const { result, rerender } = renderHook(({ key }) => useStoredPreference(key, 'default'), {
      initialProps: { key: 'test.modeA' },
    })
    expect(result.current.value).toBe('first')
    rerender({ key: 'test.modeB' })
    expect(result.current.value).toBe('second')
    act(() => { result.current.setValue('edited') })
    expect(localStorage.getItem('test.modeA')).toBe(JSON.stringify('first'))
    expect(localStorage.getItem('test.modeB')).toBe(JSON.stringify('edited'))
  })

  it('supports existing raw-string storage formats through a serializer', () => {
    const identity = (value: string) => value
    localStorage.setItem('test.raw', 'existing name')
    const { result } = renderHook(() => useStoredPreference('test.raw', '', identity, identity))
    expect(result.current.value).toBe('existing name')
    act(() => { result.current.setValue('new name') })
    expect(localStorage.getItem('test.raw')).toBe('new name')
  })
})
