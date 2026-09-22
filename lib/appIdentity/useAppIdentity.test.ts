import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_NAME, useAppIdentity } from './useAppIdentity'

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
    expect(document.title).toBe('My notes')
    act(() => second.result.current.reset())
    expect(first.result.current.name).toBe(DEFAULT_APP_NAME)
    expect(localStorage.getItem('lt.appName')).toBeNull()
  })
})
