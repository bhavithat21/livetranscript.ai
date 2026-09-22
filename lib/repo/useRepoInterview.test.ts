import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readStoredQuestions, useRepoInterview } from './useRepoInterview'

beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

async function hydrate() { await act(async () => { vi.runAllTicks(); await Promise.resolve() }) }
function tick() { act(() => { vi.advanceTimersByTime(900) }) }

describe('repository question session', () => {
  it('does not overwrite saved questions before hydration and validates saved rows', async () => {
    const saved = [{ id: 'saved', text: 'What should change?', normalized: 'wrong', capturedAt: 1, status: 'answering' }]
    localStorage.setItem('lt.repoInterview.questions.v1', JSON.stringify(saved))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useRepoInterview(() => '', false))
    expect(result.current.questions).toEqual([])
    expect(setItem).not.toHaveBeenCalled()
    await hydrate()
    expect(result.current.hydrated).toBe(true)
    expect(result.current.questions[0]).toMatchObject({ normalized: 'what should change', status: 'captured' })
    setItem.mockRestore()
    expect(readStoredQuestions('[null,{"id":1},{"id":"bad","text":"hi","capturedAt":5,"status":"broken"}]')).toEqual([])
  })

  it('clears the ledger without re-importing the old transcript at the next poll', async () => {
    let transcript = 'Where is auth handled?'
    const { result } = renderHook(() => useRepoInterview(() => transcript, true))
    await hydrate()
    expect(result.current.questions).toHaveLength(1)
    act(() => result.current.clearQuestions())
    tick()
    expect(result.current.questions).toEqual([])
    transcript += ' What happens on timeout?'
    tick()
    expect(result.current.questions.map((q) => q.text)).toEqual(['What happens on timeout?'])
  })

  it('keeps an explicitly selected question pinned when follow-ups arrive', async () => {
    let transcript = 'Where is auth handled?'
    const { result } = renderHook(() => useRepoInterview(() => transcript, true))
    await hydrate()
    const first = result.current.questions[0].id
    act(() => result.current.setSelectedId(first))
    transcript += ' What happens on timeout?'
    tick()
    expect(result.current.questions).toHaveLength(2)
    expect(result.current.selectedId).toBe(first)
  })

  it('does not mark a revised question answered by an obsolete in-flight response', async () => {
    let transcript = 'How do we cancel'
    const { result } = renderHook(() => useRepoInterview(() => transcript, true))
    await hydrate()
    const question = result.current.questions[0]
    act(() => result.current.mark(question.id, 'answering'))
    transcript += ' an order atomically?'
    tick()
    act(() => result.current.mark(question.id, 'answered', question.text))
    expect(result.current.questions[0].status).toBe('captured')
  })

  it('skips secrets and dependencies before reading their contents', async () => {
    const secret = { name: '.env.local', webkitRelativePath: 'repo/.env.local', size: 20, text: vi.fn() }
    const dependency = { name: 'index.js', webkitRelativePath: 'repo/node_modules/pkg/index.js', size: 20, text: vi.fn() }
    const code = { name: 'app.ts', webkitRelativePath: 'repo/src/app.ts', size: 30, text: vi.fn().mockResolvedValue('export function app() {}') }
    const { result } = renderHook(() => useRepoInterview(() => '', false))
    await hydrate()
    await act(async () => result.current.loadFiles([secret, dependency, code] as unknown as FileList))
    expect(secret.text).not.toHaveBeenCalled()
    expect(dependency.text).not.toHaveBeenCalled()
    expect(result.current.index?.files).toHaveLength(1)
    expect(result.current.index?.files[0].path).toBe('repo/src/app.ts')
  })
})

it('restarts the settle clock only when ASR changes question text', async () => {
  let transcript = 'How should we cancel'
  const { result } = renderHook(() => useRepoInterview(() => transcript, true))
  await hydrate()
  const first = result.current.questions[0]
  transcript += ' an order atomically'
  tick()
  expect(result.current.questions[0].capturedAt).toBe(first.capturedAt)
  expect(result.current.questions[0].updatedAt).toBe(first.capturedAt + 900)
  tick()
  expect(result.current.questions[0].updatedAt).toBe(first.capturedAt + 900)
})

it('captures new questions after clear even when ASR shortens earlier text', async () => {
  let transcript = 'Where is authentication validation being handled?'
  const { result } = renderHook(() => useRepoInterview(() => transcript, true))
  await hydrate()
  act(() => result.current.clearQuestions())
  transcript = 'Where is authentication handled? What tests verify it?'
  tick()
  expect(result.current.questions.map((q) => q.text)).toEqual(['What tests verify it?'])
  tick()
  expect(result.current.questions).toHaveLength(1)
})

it('captures a new transcript after clear instead of keeping an obsolete baseline', async () => {
  let transcript = 'Where is authentication handled?'
  const { result } = renderHook(() => useRepoInterview(() => transcript, true))
  await hydrate()
  act(() => result.current.clearQuestions())
  transcript = 'How does cancellation work?'
  tick()
  expect(result.current.questions.map((q) => q.text)).toEqual(['How does cancellation work?'])
})
