'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Type } from 'lucide-react'
import { MIN_SCALE, MAX_SCALE, useTextScale } from '@/lib/transcript/useTextScale'
import styles from './ReadingControls.module.css'

/** One device preference shared by transcript and answer reading surfaces. */
export function ReadingControls() {
  const id = useId()
  const { scale, set, reset } = useTextScale()
  const ref = useRef<HTMLDetailsElement>(null)
  const [draft, setDraft] = useState(String(Math.round(scale * 100)))
  const [position, setPosition] = useState({ left: 12, top: 60 })
  useEffect(() => setDraft(String(Math.round(scale * 100))), [scale])
  const place = () => {
    if (!ref.current?.open) return
    const rect = ref.current.getBoundingClientRect()
    setPosition({ left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 260)) })
  }
  useEffect(() => { window.addEventListener('resize', place); return () => window.removeEventListener('resize', place) }, [])
  const commit = () => {
    const next = draft.trim() ? Number(draft) : scale * 100
    set(next / 100)
    setDraft(String(Math.round(Math.min(MAX_SCALE * 100, Math.max(MIN_SCALE * 100, Number.isFinite(next) ? next : 100)))))
  }
  return <details className={styles.control} ref={ref} onToggle={place}>
    <summary aria-label="Text size and reading preferences"><Type size={16} aria-hidden /><span>Text size</span><span className={styles.value}>{Math.round(scale * 100)}%</span></summary>
    <div className={styles.panel} style={position}>
      <label htmlFor={id}>Reading text size</label>
      <input id={id} aria-label="Reading text size" type="range" min={MIN_SCALE * 100} max={MAX_SCALE * 100} step="5" value={scale * 100} onChange={event => set(Number(event.target.value) / 100)} />
      <div><label>Custom %<input aria-label="Custom text size percent" type="number" min={MIN_SCALE * 100} max={MAX_SCALE * 100} step="5" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur() } }} /></label><button type="button" onClick={reset}>Reset</button></div>
      <p>Resizes answers and transcript text. Your choice is saved on this device.</p>
    </div>
  </details>
}
