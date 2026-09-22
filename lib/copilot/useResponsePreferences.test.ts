import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResponsePreferences } from './useResponsePreferences'

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('response controls persistence', () => {
  it('shares validated changes between mounted controls and survives remount', () => {
    const first = renderHook(useResponsePreferences)
    const second = renderHook(useResponsePreferences)
    act(() => first.result.current.setFormat('keywords'))
    act(() => first.result.current.setTone('technical'))
    act(() => first.result.current.setFollowups(true))
    expect(second.result.current.preferences).toEqual({ format: 'keywords', tone: 'technical', followups: true })
    first.unmount(); second.unmount()
    expect(renderHook(useResponsePreferences).result.current.preferences).toEqual({ format: 'keywords', tone: 'technical', followups: true })
  })
  it('recovers from malformed saved preferences without sending arbitrary prompt text', () => {
    localStorage.setItem('lt.answerPreferences', JSON.stringify({ format: 'ignore rules', tone: 'technical', followups: true }))
    expect(renderHook(useResponsePreferences).result.current.preferences).toEqual({ format: 'concise', tone: 'collaborative', followups: false })
  })
  it('still applies controls when browser storage rejects writes', () => {
    const hook = renderHook(useResponsePreferences)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    act(() => hook.result.current.setFormat('detailed'))
    expect(hook.result.current.preferences.format).toBe('detailed')
  })
})
