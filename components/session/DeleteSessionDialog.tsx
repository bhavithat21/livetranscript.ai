'use client'

import { useEffect, useId, useRef } from 'react'
import { Trash2 } from 'lucide-react'

/** Native dialog owns modality, keyboard containment and Escape behavior. */
export function DeleteSessionDialog({ open, title, pending, error, onCancel, onDelete }: {
  open: boolean
  title: string
  pending: boolean
  error: string | null
  onCancel: () => void
  onDelete: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    dialog?.showModal()
    keepRef.current?.focus()
    return () => {
      dialog?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!pending) onCancel() }}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-6 text-ink shadow-xl backdrop:bg-black/40"
    >
      <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--stop)]/10 text-[color:var(--stop)]"><Trash2 size={19} aria-hidden /></span>
      <h2 id={titleId} className="text-xl font-semibold tracking-tight">Delete transcript?</h2>
      <p id={descriptionId} className="mt-2 break-words text-sm leading-6 text-[color:var(--muted)]">“{title}” and its summary will be permanently deleted. Its shared link will stop working. Export a copy first if you need to keep it.</p>
      {error && <p role="alert" className="mt-3 text-sm text-[color:var(--stop)]">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" ref={keepRef} disabled={pending} onClick={onCancel} className="btn-ghost">Keep transcript</button>
        <button type="button" disabled={pending} onClick={onDelete} className="btn-stop min-w-36" aria-busy={pending}>{pending ? 'Deleting…' : 'Delete permanently'}</button>
      </div>
    </dialog>
  )
}
