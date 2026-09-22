import { describe, expect, it } from 'vitest'
import { createInterviewHistory } from './history'
import { historyKey, type InterviewSession } from './session'

function disk() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size } } satisfies Storage
}
function session(id = 's1'): InterviewSession {
  return { id, kind: 'mock', title: 'Practice', createdAt: 1, durationSeconds: 10, transcript: 'Candidate: example', turns: [], captureNote: 'Test' }
}
describe('interview device history', () => {
  it('saves and reloads for the same owner only', () => {
    const storage = disk()
    const first = createInterviewHistory('alice', () => storage)
    first.add(session())
    expect(createInterviewHistory('alice', () => storage).getSnapshot().sessions).toHaveLength(1)
    expect(createInterviewHistory('bob', () => storage).getSnapshot().sessions).toHaveLength(0)
  })
  it('has a stable empty server snapshot and stable client snapshots', () => {
    const storage = disk()
    const store = createInterviewHistory('alice', () => storage)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    store.add(session())
    expect(store.getServerSnapshot().sessions).toEqual([])
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
  it('retains in-memory work when storage is unavailable', () => {
    const store = createInterviewHistory('alice', () => undefined)
    store.add(session())
    expect(store.getSnapshot().sessions).toHaveLength(1)
    expect(store.getSnapshot().error).toContain('only in this tab')
  })
  it('does not overwrite corrupt stored data', () => {
    const storage = disk()
    storage.setItem(historyKey('alice'), '{bad json')
    const store = createInterviewHistory('alice', () => storage)
    store.add(session())
    expect(storage.getItem(historyKey('alice'))).toBe('{bad json')
    expect(store.getSnapshot().error).toContain('not been overwritten')
  })
  it('updates feedback only on its original session', () => {
    const storage = disk()
    const store = createInterviewHistory('alice', () => storage)
    store.add(session('one')); store.add(session('two'))
    store.review('one', 'First feedback', 'Full')
    expect(store.getSnapshot().sessions.find((s) => s.id === 'one')?.feedback).toBe('First feedback')
    expect(store.getSnapshot().sessions.find((s) => s.id === 'two')?.feedback).toBeUndefined()
  })
  it('never resurrects deleted sessions when a review finishes late', () => {
    const storage = disk()
    const store = createInterviewHistory('alice', () => storage)
    store.add(session()); store.remove('s1'); store.review('s1', 'late', 'Full')
    expect(store.getSnapshot().sessions).toHaveLength(0)
    expect(createInterviewHistory('alice', () => storage).getSnapshot().sessions).toHaveLength(0)
  })
  it('notifies subscribers and retains the latest twenty sessions', () => {
    const storage = disk()
    const store = createInterviewHistory('alice', () => storage)
    let calls = 0
    const unsubscribe = store.subscribe(() => { calls++ })
    for (let i = 0; i < 25; i++) store.add(session(String(i)))
    expect(calls).toBe(25)
    expect(store.getSnapshot().sessions).toHaveLength(20)
    expect(store.getSnapshot().sessions[0].id).toBe('24')
    unsubscribe()
  })
  it('rejects malformed sessions rather than persisting arbitrary values', () => {
    const storage = disk()
    const store = createInterviewHistory('alice', () => storage)
    expect(() => store.add({ ...session(), durationSeconds: Infinity })).toThrow()
    expect(store.getSnapshot().sessions).toHaveLength(0)
  })
})
