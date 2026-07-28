'use client'
import styles from './LeverSwitch.module.css'

interface LeverSwitchProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  /** Accessible name — the control renders no visible text. */
  label?: string
  /** Render as a non-interactive state indicator (e.g. inside a clickable row).
      No checkbox is emitted, so it's valid inside a <button>. */
  decorative?: boolean
}

// Skeuomorphic lever toggle (Apple-style): track fills emerald when on, knob
// slides with a springy throw and a lever bar trails it. State styling keys off
// data-checked so the interactive checkbox and the decorative variant share CSS.
export function LeverSwitch({ checked, onChange, label, decorative = false }: LeverSwitchProps) {
  return (
    <div className={styles.toggleContainer} data-checked={checked}>
      {!decorative && (
        <input
          className={styles.toggleInput}
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
        />
      )}
      <div className={styles.toggleHandleWrapper}>
        <div className={styles.toggleHandle}>
          <div className={styles.toggleHandleKnob} />
          <div className={styles.toggleHandleBarWrapper}>
            <div className={styles.toggleHandleBar} />
          </div>
        </div>
      </div>
      <div className={styles.toggleBase}>
        <div className={styles.toggleBaseInside} />
      </div>
    </div>
  )
}
