'use client'
import styles from './LeverSwitch.module.css'

interface LeverSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name — the control renders no visible text. */
  label: string
}

// Skeuomorphic lever toggle (Apple-style): track fills emerald when on, knob
// slides with a springy throw and a lever bar trails it. Pure CSS state via
// the hidden checkbox's :checked sibling selectors.
export function LeverSwitch({ checked, onChange, label }: LeverSwitchProps) {
  return (
    <div className={styles.toggleContainer}>
      <input
        className={styles.toggleInput}
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
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
