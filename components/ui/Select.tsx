'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

// In-DOM dropdown that replaces native <select>. WHY THIS EXISTS: WebView2 draws
// a native <select>'s option popup as a SEPARATE OS child window, which the
// window's WDA_EXCLUDEFROMCAPTURE (contentProtected) flag does NOT cover — so the
// popup leaks onto screen shares even though the app window is hidden. Rendering
// the list inside the DOM keeps it on the protected webview surface.
//
// Keyboard + ARIA listbox so it stays as accessible as the native control it
// replaces. Closed trigger matches the app's pill inputs; on desktop the
// lt-desktop theme repaints it dark like everything else.

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectProps<T extends string> {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
  className?: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  title,
  className = '',
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-${i}`
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const selected = options[selectedIndex] ?? options[0]

  // Close on outside click / Escape, so it behaves like a real menu.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const openMenu = useCallback(() => {
    if (disabled) return
    setActiveIndex(selectedIndex)
    setOpen(true)
  }, [disabled, selectedIndex])

  const commit = useCallback(
    (i: number) => {
      const opt = options[i]
      if (opt) onChange(opt.value)
      setOpen(false)
    },
    [options, onChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      if (!open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          openMenu()
        }
        return
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((i) => Math.min(options.length - 1, i + 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((i) => Math.max(0, i - 1))
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          commit(activeIndex)
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          break
        case 'Tab':
          // Focus stays on the button (ARIA combobox pattern), so let Tab move it
          // naturally — but close the popup first so it doesn't linger with
          // aria-expanded stuck true after focus leaves.
          setOpen(false)
          break
      }
    },
    [disabled, open, openMenu, options.length, commit, activeIndex],
  )

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white/70 px-3 py-1.5 text-sm outline-none focus-visible:border-emerald-700 disabled:opacity-60"
      >
        <span>{selected?.label}</span>
        <ChevronDown size={14} className="text-black/45" aria-hidden />
      </button>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="glass absolute right-0 z-50 mt-1 min-w-full overflow-hidden rounded-2xl p-1 shadow-lg"
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value
            return (
              <li
                key={opt.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(i)}
                data-active={i === activeIndex}
                className="flex min-h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm text-black/70 data-[active=true]:bg-black/5 data-[active=true]:text-ink"
              >
                <Check
                  size={14}
                  className={isSelected ? 'text-emerald-700' : 'opacity-0'}
                  aria-hidden
                />
                {opt.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
