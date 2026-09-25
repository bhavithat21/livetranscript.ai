'use client'
import { useState } from 'react'
import { TranscriptView } from './TranscriptView'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import type { Segment } from '@/lib/transcript/store'
import styles from './TranscriptReader.module.css'

/** Read-only grouping switch; never sends the shared transcript to another model. */
export function TranscriptReader({ segments }: { segments: Segment[] }) {
  const [reading, setReading] = useState(true)
  return <>
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="group" aria-label="Transcript display">
        <button type="button" className={styles.tab} aria-pressed={reading} onClick={() => setReading(true)}>Reading view</button>
        <button type="button" className={styles.tab} aria-pressed={!reading} onClick={() => setReading(false)}>Original segments</button>
      </div>
      <p className={styles.note}>Grouped for reading. Saved wording is unchanged.</p>
      <ThemeToggle />
    </div>
    <TranscriptView segments={segments} readerMode={reading} flow />
  </>
}
