'use client'
import { useSyncExternalStore } from 'react'
import { Minus, Square, X, MousePointer2, Layers2 } from 'lucide-react'
import { isTauri } from '@/lib/audio/useNativeCapture'
import { useLockMode } from '@/lib/desktop/useLockMode'
import styles from './TitleBar.module.css'

// Global desktop control surface, present in Live, Mock, transcript and settings.
// A dedicated drag region never consumes clicks intended for the controls.
export function TitleBar() {
  const show = useSyncExternalStore(subscribeToDesktopRuntime, isTauri, () => false)
  return show ? <DesktopTitleBar /> : null
}
function DesktopTitleBar() {
  const mode = useLockMode()
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const shortcut = mac ? '⌘⇧L' : 'Ctrl+Shift+L'
  const recovery = mode.shortcutAvailable ? `${shortcut} to restore clicks` : mode.trayAvailable ? 'Tray → Restore mouse interaction' : 'Desktop update or recovery control required'
  const win = async () => (await import('@tauri-apps/api/window')).getCurrentWindow()
  const inputLabel = mode.busy ? 'Changing input…' : mode.locked ? 'Pass-through on' : 'Pass through'
  return <>
    <div className={styles.bar} role="toolbar" aria-label="Desktop window controls">
      <button type="button" className={styles.input} aria-label="Pass through mouse clicks" aria-pressed={mode.locked}
        disabled={mode.busy || (!mode.locked && !mode.canEnable)}
        title={`Clicks go to the window underneath, not to both apps. ${recovery}. Fixed arrow inside LiveTranscript.`}
        onClick={() => void mode.toggle()}>
        {mode.locked ? <Layers2 size={13} /> : <MousePointer2 size={13} />}{inputLabel}
      </button>
      <span className={styles.recovery} role="status" title={recovery}>{mode.locked ? recovery : mode.shortcutAvailable ? shortcut : 'Fixed arrow'}</span>
      <div data-tauri-drag-region className={styles.drag} aria-label="Drag window" />
      <div className={styles.controls}>
        <TitleBarButton label="Minimize" onClick={async () => (await win()).minimize()}><Minus size={14} /></TitleBarButton>
        <TitleBarButton label="Maximize" onClick={async () => (await win()).toggleMaximize()}><Square size={11} /></TitleBarButton>
        <TitleBarButton label="Close" danger onClick={async () => (await win()).close()}><X size={14} /></TitleBarButton>
      </div>
    </div>
    {mode.error && <div className={styles.error} role="alert"><span>{mode.error}</span><button type="button" aria-label="Dismiss mouse input message" onClick={mode.clearError}><X size={14} /></button></div>}
  </>
}
function subscribeToDesktopRuntime(): () => void { return () => {} }
function TitleBarButton({ children, onClick, label, danger = false }: {
  children: React.ReactNode; onClick: () => Promise<void>; label: string; danger?: boolean
}) {
  return <button type="button" aria-label={label} title={label} onClick={() => { void onClick().catch(() => { /* OS window controls can be unavailable while closing. */ }) }}
    className={`${styles.control} ${danger ? styles.danger : ''}`}>{children}</button>
}
