import { decodeHistory, historyKey, isSession, MAX_HISTORY, type InterviewSession } from './session'

type Snapshot = { sessions: InterviewSession[]; error: string | null }
const EMPTY: Snapshot = { sessions: [], error: null }
export type HistoryStore = ReturnType<typeof createInterviewHistory>

/** Account-scoped device history. A stable external-store snapshot avoids hydration
 * mismatches. Failed persistence remains in memory, with a visible warning. */
export function createInterviewHistory(owner: string, storage: () => Storage | undefined) {
  const key = historyKey(owner)
  let snapshot: Snapshot = EMPTY
  let loaded = false
  let corrupt = false
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  function read() {
    try {
      const disk = storage()
      if (!disk) throw new Error('Device storage is unavailable.')
      snapshot = { sessions: decodeHistory(disk.getItem(key), owner), error: null }
      corrupt = false
    } catch (error) {
      corrupt = true
      snapshot = { ...snapshot, error: `${error instanceof Error ? error.message : 'Could not load interview history.'} New work stays in this tab until storage is available; export it before leaving.` }
    }
    loaded = true
  }
  function commit(sessions: InterviewSession[]) {
    let error: string | null = null
    const recent = sessions.slice(0, MAX_HISTORY)
    try {
      // Do not overwrite unreadable history silently.
      if (corrupt) throw new Error('Existing device history could not be loaded and has not been overwritten.')
      const disk = storage()
      if (!disk) throw new Error('Device storage is unavailable.')
      disk.setItem(key, JSON.stringify({ version: 1, owner, sessions: recent }))
    } catch (e) {
      error = `${e instanceof Error ? e.message : 'Could not save history.'} This session is available only in this tab. Export it before leaving.`
    }
    snapshot = { sessions: recent, error }
    notify()
  }
  return {
    getSnapshot: () => { if (!loaded) read(); return snapshot },
    getServerSnapshot: () => EMPTY,
    subscribe(listener: () => void) {
      listeners.add(listener)
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return
        // Preserve unsaved in-memory work instead of replacing it with another tab.
        if (snapshot.error) return
        read()
        notify()
      }
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      }
    },
    add(session: InterviewSession) {
      if (!loaded) read()
      if (!isSession(session)) throw new Error('Session is too large or malformed. Copy the transcript before leaving.')
      commit([session, ...snapshot.sessions.filter((item) => item.id !== session.id)])
    },
    review(id: string, feedback: string, coverage: string) {
      if (!loaded) read()
      // An in-flight review cannot resurrect a deleted session.
      if (!snapshot.sessions.some((session) => session.id === id)) return
      commit(snapshot.sessions.map((session) => session.id === id ? { ...session, feedback, feedbackCoverage: coverage } : session))
    },
    remove(id: string) { if (!loaded) read(); commit(snapshot.sessions.filter((session) => session.id !== id)) },
  }
}
