import type { RetryNotice } from './retry'
export type RetryStage = 'screen_model' | 'talk' | 'guide' | 'review'
export type RetryDisplay = RetryNotice & { id: number; stage: RetryStage }
const EMPTY: readonly RetryDisplay[] = []
let snapshot: readonly RetryDisplay[] = EMPTY, serial = 0
const listeners = new Set<() => void>()
export const getRetryStatus = () => snapshot
export const getServerRetryStatus = () => EMPTY
export const subscribeRetryStatus = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
function publish(next: readonly RetryDisplay[]) { snapshot = next; for (const fn of listeners) { try { fn() } catch { /* display must not affect requests */ } } }
/** Ephemeral UI state, separate from diagnostic recording/consent and persistence. */
export function retryDisplay(stage: RetryStage) {
  const id = ++serial
  return {
    retry(notice: RetryNotice) { publish([...snapshot.filter(item => item.id !== id), { id, stage, ...notice }].slice(-4)) },
    finish() { if (snapshot.some(item => item.id === id)) publish(snapshot.filter(item => item.id !== id)) },
  }
}
