'use client'
import { Monitor } from 'lucide-react'
import styles from './RepositoryWorkspace.module.css'
import type { NativeDisplay } from '@/lib/repo/live/nativeCapture'
export function NativeCaptureControls({ available, displays, busy, choose, start }: { available: boolean; displays: NativeDisplay[]; busy: boolean; choose: () => Promise<void>; start: (id: string) => Promise<void> }) {
  if (!available) return null
  return <><button className={styles.button} disabled={busy} onClick={() => void choose()}><Monitor size={15} />Desktop display</button>{displays.length > 0 && <fieldset className={styles.notice}><legend>Select the display you permit the assistant to observe</legend><p>This shares its visible contents with the configured AI service. Close confidential windows first.</p><div className={styles.controls}>{displays.map(display => <button type="button" className={styles.button} key={display.id} onClick={() => void start(display.id)}>Observe {display.name} · {display.width} × {display.height}</button>)}</div></fieldset>}</>
}
