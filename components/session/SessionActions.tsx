'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { Check, Download, Link2, Pencil, Trash2 } from 'lucide-react'
import { renameSession, deleteSession, createShare, revokeShare } from '@/app/(app)/session-actions'
import { DeleteSessionDialog } from './DeleteSessionDialog'

type Props = {
  id: string
  title: string
  shared: boolean
  transcript: string
}

// Mutations remain owner-scoped server actions. Completed changes refresh the row.
export function SessionActions({ id, title, shared, transcript }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const mutationRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(title)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareActive, setShareActive] = useState(shared)
  const [shareHours, setShareHours] = useState('24')
  const nameRef = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLButtonElement>(null)

  const mutate = (action: () => Promise<void>, fallback: string) => {
    if (mutationRef.current) return
    mutationRef.current = true
    setMsg(null)
    setError(null)
    startTransition(async () => {
      try { await action() }
      catch { setError(fallback) }
      finally { mutationRef.current = false }
    })
  }

  const saveName = () => {
    const clean = name.trim()
    if (!clean) { setError('Enter a title for this transcript.'); nameRef.current?.focus(); return }
    mutate(async () => {
      await renameSession(id, clean)
      setName(clean)
      setEditing(false)
      setMsg('Title saved')
      router.refresh()
      requestAnimationFrame(() => renameRef.current?.focus())
    }, 'The title could not be saved. Your changes are still here; try again.')
  }

  const share = () => mutate(async () => {
    const hours = Number(shareHours)
    const label = hours === 1 ? '1 hour' : hours === 24 ? '24 hours' : '7 days'
    const { url } = await createShare(id, hours)
    const absoluteUrl = new URL(url, window.location.origin).href
    setShareUrl(absoluteUrl)
    setShareActive(true)
    router.refresh()
    try {
      await navigator.clipboard.writeText(absoluteUrl)
      setMsg(`Link copied. It expires in ${label}.`)
    } catch {
      setMsg(`Link created for ${label}. Copy it from the field below.`)
    }
  }, 'A share link could not be created. Check your connection and try again.')

  const stopSharing = () => mutate(async () => {
    await revokeShare(id)
    setShareUrl(null)
    setShareActive(false)
    setMsg('Sharing stopped. The previous link no longer works.')
    router.refresh()
  }, 'Sharing could not be stopped. The link may still work; try again.')

  const exportTxt = () => {
    const blob = new Blob([transcript], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'transcript'}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const remove = () => mutate(async () => {
    await deleteSession(id)
    setConfirmDelete(false)
    router.push('/dashboard')
    router.refresh()
  }, 'The transcript could not be deleted. It has been kept here; try again.')

  return (
    <div className="space-y-5">
      {editing ? (
        <form noValidate onSubmit={(event) => { event.preventDefault(); saveName() }} className="space-y-2">
          <label htmlFor="session-title" className="text-sm font-medium">Transcript title</label>
          <input
            ref={nameRef}
            id="session-title"
            autoFocus
            value={name}
            maxLength={200}
            disabled={pending}
            onChange={(event) => { setName(event.target.value); setError(null) }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) { if (event.key === 'Enter') event.preventDefault(); return }
              if (event.key === 'Enter') { event.preventDefault(); saveName() }
              if (event.key === 'Escape' && !pending) { setName(title); setEditing(false); setError(null); requestAnimationFrame(() => renameRef.current?.focus()) }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'session-action-error' : undefined}
            className="w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 py-2.5 text-lg outline-none focus:border-[color:var(--signal)]"
          />
          <div className="flex gap-2"><button type="submit" disabled={pending} className="btn-signal min-w-28 text-sm">{pending ? 'Saving…' : 'Save title'}</button><button type="button" disabled={pending} className="btn-ghost text-sm" onClick={() => { setName(title); setEditing(false); setError(null); requestAnimationFrame(() => renameRef.current?.focus()) }}>Cancel</button></div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{name}</h1>
          <button ref={renameRef} type="button" aria-label="Rename transcript" disabled={pending} onClick={() => { setError(null); setEditing(true) }} className="btn-ghost shrink-0 gap-2 text-sm"><Pencil size={14} aria-hidden /><span className="hidden sm:inline">Rename</span><span className="sr-only sm:hidden">Rename transcript</span></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => setShareOpen((open) => !open)} aria-expanded={shareOpen} aria-controls="session-sharing" className="btn-ghost gap-2 text-sm"><Link2 size={15} aria-hidden />Share transcript{shareActive && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-600" aria-label="Sharing active" />}</button>
        <button type="button" onClick={exportTxt} className="btn-ghost gap-2 text-sm"><Download size={15} aria-hidden />Export .txt</button>
        <button type="button" disabled={pending} onClick={() => { setError(null); setConfirmDelete(true) }} className="btn-ghost ml-auto gap-2 text-sm" aria-label="Delete transcript"><Trash2 size={15} aria-hidden /><span className="hidden sm:inline">Delete</span></button>
      </div>

      {shareOpen && <div id="session-sharing" className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] p-4">
        <h2 className="text-sm font-semibold">Share a read-only transcript</h2>
        <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">Anyone with the link can read this transcript and summary until it expires. Creating a new link replaces the previous one.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium">Link expires after<select value={shareHours} disabled={pending} onChange={(event) => setShareHours(event.target.value)} className="min-h-11 rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 text-sm"><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option></select></label>
          <button type="button" disabled={pending} onClick={share} className="btn-signal min-w-32 gap-2 text-sm"><Link2 size={14} aria-hidden />Create link</button>
          {shareActive && <button type="button" disabled={pending} onClick={stopSharing} className="btn-ghost text-sm">Stop sharing</button>}
        </div>
        {shareUrl && <label className="mt-3 block text-xs font-medium">Share link<input readOnly value={shareUrl} onFocus={(event) => event.target.select()} className="mt-1.5 min-h-11 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 text-sm font-normal" /></label>}
      </div>}
      {msg && <p role="status" className="flex items-start gap-2 text-sm text-[color:var(--signal)]"><Check size={15} className="mt-0.5 shrink-0" aria-hidden />{msg}</p>}
      {error && !confirmDelete && <p id="session-action-error" role="alert" className="text-sm text-[color:var(--stop)]">{error}</p>}
      <DeleteSessionDialog open={confirmDelete} title={name} pending={pending} error={error} onCancel={() => { setConfirmDelete(false); setError(null) }} onDelete={remove} />
    </div>
  )
}
