'use client'
import { useSyncExternalStore } from 'react'
import { getRetryStatus, getServerRetryStatus, subscribeRetryStatus } from '@/lib/coach/retryStatus'
import styles from './RetryStatus.module.css'
const LABELS = { screen_model: 'Screen analysis', talk: 'Spoken guidance', guide: 'Code guidance', review: 'Code review' }
export function RetryStatus() {
  const retries = useSyncExternalStore(subscribeRetryStatus, getRetryStatus, getServerRetryStatus)
  if (!retries.length) return null
  return <aside className={styles.notice} role="status" aria-live="polite" aria-atomic="true">
    {retries.map(item => <p key={item.id}>{LABELS[item.stage]}: retrying · attempt {item.attempt} of {item.maxAttempts}</p>)}
    <small>Temporary failure. Stop or pause the session to cancel.</small>
  </aside>
}
