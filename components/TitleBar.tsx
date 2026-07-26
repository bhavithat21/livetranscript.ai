'use client'
import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { isTauri } from '@/lib/audio/useNativeCapture'

// Custom frameless title bar for the Tauri desktop shell. The native window runs
// with `decorations: false`, so this thin bar replaces the OS title bar: it's the
// window's drag handle (data-tauri-drag-region) and carries minimize / maximize /
// close controls. Renders ONLY inside Tauri — the web app at livetranscript.ai
// never shows it (isTauri() is false in a browser).
//
// Height is exposed as --titlebar-h so the app content can offset below it; the
// lt-desktop theme wires that up in globals.css.

export function TitleBar() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    setShow(isTauri())
  }, [])

  if (!show) return null

  const win = async () => (await import('@tauri-apps/api/window')).getCurrentWindow()

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-[200] flex h-[var(--titlebar-h)] items-center justify-end px-2"
    >
      {/* Buttons opt OUT of the drag region so clicks register as clicks, not drags. */}
      <div className="flex items-center gap-1" data-tauri-drag-region="false">
        <TitleBarButton
          label="Minimize"
          onClick={async () => (await win()).minimize()}
        >
          <Minus size={14} />
        </TitleBarButton>
        <TitleBarButton
          label="Maximize"
          onClick={async () => (await win()).toggleMaximize()}
        >
          <Square size={11} />
        </TitleBarButton>
        <TitleBarButton
          label="Close"
          danger
          onClick={async () => (await win()).close()}
        >
          <X size={14} />
        </TitleBarButton>
      </div>
    </div>
  )
}

function TitleBarButton({
  children,
  onClick,
  label,
  danger = false,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-white/60 transition-colors hover:text-white ${
        danger ? 'hover:bg-red-500/80' : 'hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  )
}
