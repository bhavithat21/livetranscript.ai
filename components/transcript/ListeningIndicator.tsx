'use client'
import type { CSSProperties } from 'react'
import styles from './ListeningIndicator.module.css'

/** Capturing is not the same as hearing speech. Level comes from the audio meter,
 * never from a random animation. No audio content is retained here. */
export function ListeningIndicator({ active, level = 0, label }: { active: boolean; level?: number; label?: string }) {
  const amplitude = Number.isFinite(level) ? Math.min(1, Math.max(0, level) * 8) : 0
  const speaking = active && amplitude > .04
  return <span className={styles.indicator} data-active={active} data-speaking={speaking}>
    <span className={styles.bars} aria-hidden style={{ '--amplitude': amplitude } as CSSProperties}>{[.45, .7, 1, .65, .9].map((height, index) => <i key={index} style={{ '--bar-height': height, '--delay': `${index * -120}ms` } as CSSProperties} />)}</span>
    <span>{label || (speaking ? 'Speech detected' : active ? 'Listening' : 'Audio paused')}</span>
  </span>
}
