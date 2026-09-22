'use client'

import { useEffect, useRef, useState } from 'react'
import type { RemoteSessionClient } from '@/lib/remote/client'
import { readJpegDimensions } from '@/lib/remote/frames'

export interface RemoteScreenHandle { draw: (jpeg: Uint8Array) => void }

/** The pixel surface is the one intentional application-style keyboard region.
 * Escape always exits it; all other controls retain ordinary browser semantics. */
export function RemoteScreen({ client, enabled, screenRef }: {
  client: RemoteSessionClient | null
  enabled: boolean
  screenRef: React.RefObject<RemoteScreenHandle | null>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const lastMove = useRef(0)
  const pressedKeys = useRef(new Map<string, string>())
  const [received, setReceived] = useState(false)
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let disposed = false
    let decoding = false
    let latest: Uint8Array | null = null
    const paintNext = () => {
      if (disposed || decoding || !latest) return
      const jpeg = latest
      latest = null
      decoding = true
      void decodeFrame(jpeg).then((bitmap) => {
        try {
          const target = canvas.current
          if (disposed || !target) return
          if (bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 4_194_304) {
            setNotice('The shared screen is too large to display. Ask the laptop owner to reconnect.')
            return
          }
          if (target.width !== bitmap.width) target.width = bitmap.width
          if (target.height !== bitmap.height) target.height = bitmap.height
          target.getContext('2d')?.drawImage(bitmap, 0, 0)
          setReceived(true)
        } finally { bitmap.close() }
      }).catch(() => {
        if (!disposed) setNotice('A screen frame could not be displayed. Waiting for the next frame.')
      }).finally(() => {
        decoding = false
        paintNext()
      })
    }
    screenRef.current = {
      draw(jpeg) {
        if (disposed) return
        if (!readJpegDimensions(jpeg)) { setNotice('An invalid screen frame was ignored. Waiting for the next frame.'); return }
        // One active decoder and one latest pending frame. Slow devices neither
        // accumulate decoders nor discard every frame in an endless race.
        latest = jpeg
        paintNext()
      },
    }
    return () => {
      disposed = true
      latest = null
      screenRef.current = null
      client?.releaseInputs()
    }
  }, [client, screenRef])

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const onWheel = (event: WheelEvent) => {
      if (!enabled || !received || document.activeElement !== target) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(40, target.clientHeight) : 1
      const ticks = (value: number) => value === 0 ? 0 : Math.sign(value) * Math.min(20, Math.max(1, Math.round(Math.abs(value) * unit / 40)))
      if (client?.sendInput({ type: 'scroll', deltaX: ticks(event.deltaX), deltaY: ticks(event.deltaY) })) event.preventDefault()
    }
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => target.removeEventListener('wheel', onWheel)
  }, [client, enabled, received])

  function releaseInputs() {
    pressedKeys.current.clear()
    client?.releaseInputs()
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>, immediate = false) {
    if (!enabled || !received) return false
    if (!immediate && performance.now() - lastMove.current < 35) return false
    lastMove.current = performance.now()
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    return client?.sendInput({ type: 'move', x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }) ?? false
  }

  function buttonFor(value: number): 'left' | 'middle' | 'right' | null {
    return value === 0 ? 'left' : value === 1 ? 'middle' : value === 2 ? 'right' : null
  }

  return (
    <section aria-label="Shared laptop screen" className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-black/15 bg-black/5">
        {!received && <p className="px-6 py-10 text-center text-sm text-black/60" role="status">Waiting for the laptop’s first screen frame…</p>}
        <canvas
          ref={canvas}
          width={1280}
          height={720}
          role="application"
          tabIndex={enabled && received ? 0 : -1}
          aria-label={enabled ? 'Remote laptop. Click to control. Press Escape to return to local controls.' : 'Remote laptop screen, view only'}
          aria-describedby="remote-keyboard-help"
          className={`${received ? 'block' : 'hidden'} h-auto w-full focus-visible:outline-4 focus-visible:outline-offset-[-4px] focus-visible:outline-[color:var(--signal)] ${enabled ? 'cursor-crosshair touch-none' : ''}`}
          onPointerMove={(event) => { move(event) }}
          onPointerDown={(event) => {
            if (!enabled || !move(event, true)) return
            const button = buttonFor(event.button)
            if (!button) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            client?.sendInput({ type: 'button', button, down: true })
          }}
          onPointerUp={(event) => {
            if (!enabled) return
            move(event, true)
            const button = buttonFor(event.button)
            if (button) client?.sendInput({ type: 'button', button, down: false })
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={releaseInputs}
          onLostPointerCapture={releaseInputs}
          onContextMenu={(event) => { if (enabled) event.preventDefault() }}
          onKeyDown={(event) => {
            if (!enabled || event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              event.preventDefault()
              releaseInputs()
              event.currentTarget.blur()
              return
            }
            if (event.repeat) { event.preventDefault(); return }
            if (client?.sendInput({ type: 'key', key: event.key, down: true })) {
              pressedKeys.current.set(event.code || event.key, event.key)
              event.preventDefault()
            }
          }}
          onKeyUp={(event) => {
            const code = event.code || event.key
            const key = pressedKeys.current.get(code)
            pressedKeys.current.delete(code)
            if (enabled && key && client?.sendInput({ type: 'key', key, down: false })) event.preventDefault()
          }}
          onBlur={releaseInputs}
        >Your browser cannot display the shared laptop screen.</canvas>
      </div>
      <p id="remote-keyboard-help" className="text-sm text-black/60">
        {enabled ? 'Click the screen to use your mouse and keyboard. Escape returns focus here. Some browser and system shortcuts stay on your device.' : 'View only. The laptop owner can enable mouse and keyboard control.'}
      </p>
      {enabled && (
        <form noValidate className="space-y-2" onSubmit={(event) => {
          event.preventDefault()
          if (text && client?.sendInput({ type: 'text', text })) { setText(''); setNotice('Text sent to the laptop’s focused field.') }
        }}>
          <label htmlFor="remote-text" className="block text-sm font-medium">Send text to the focused field</label>
          <textarea id="remote-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={3} autoComplete="off" spellCheck={false} data-ph-no-capture aria-describedby="remote-text-help" className="w-full resize-none rounded-2xl border border-black/15 bg-transparent p-3 text-sm" />
          <p id="remote-text-help" className="text-xs text-black/60">Useful on a phone or for pasted code. Click the target field on the shared screen first.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-signal text-sm" disabled={!text.trim()}>Send text</button>
            <button type="button" className="btn-ghost text-sm" onClick={() => { client?.sendInput({ type: 'key', key: 'Escape', down: true }); client?.sendInput({ type: 'key', key: 'Escape', down: false }) }}>Send Escape</button>
          </div>
        </form>
      )}
      <p className="min-h-5 text-sm text-black/60" role="status">{notice}</p>
    </section>
  )
}

async function decodeFrame(jpeg: Uint8Array): Promise<{ width: number; height: number; close(): void } & CanvasImageSource> {
  const blob = new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' })
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error('Frame decode timed out')) }, 3_000)
    image.onload = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      image.width = image.naturalWidth
      image.height = image.naturalHeight
      resolve(Object.assign(image, { close() {} }))
    }
    image.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error('Invalid frame')) }
    image.src = url
  })
}
