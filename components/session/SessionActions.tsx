'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { renameSession, deleteSession, createShare, revokeShare } from '@/app/(app)/session-actions'

type Props = {
  id: string
  title: string
  shared: boolean
  transcript: string
}

// Owner controls for one saved session: rename, share (with TTL) / revoke,
// export the transcript, and delete. All mutations go through owner-scoped
// server actions; the row is re-fetched via router.refresh() after each.
export function SessionActions({ id, title, shared, transcript }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(title)
  const [msg, setMsg] = useState<string | null>(null)

  const saveName = () => {
    setEditing(false)
    if (name.trim() && name !== title) {
      startTransition(async () => {
        await renameSession(id, name)
        router.refresh()
      })
    }
  }

  const share = (ttlHours: number, label: string) =>
    startTransition(async () => {
      try {
        const { url } = await createShare(id, ttlHours)
        await navigator.clipboard.writeText(url)
        setMsg(`Link copied — expires in ${label}`)
        router.refresh()
      } catch {
        setMsg('Sharing needs sign-in + database')
      }
    })

  const stopSharing = () =>
    startTransition(async () => {
      await revokeShare(id)
      setMsg('Sharing stopped')
      router.refresh()
    })

  const exportTxt = () => {
    const blob = new Blob([transcript], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'transcript'}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const remove = () => {
    if (!confirm('Delete this transcript permanently?')) return
    startTransition(async () => {
      await deleteSession(id)
      router.push('/dashboard')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white/60 px-3 py-1.5 font-[family-name:var(--font-serif)] text-2xl outline-none focus:border-emerald-700"
          />
        ) : (
          <h1
            onClick={() => setEditing(true)}
            className="cursor-text font-[family-name:var(--font-serif)] text-3xl tracking-[-0.01em] hover:text-black/70"
            title="Click to rename"
          >
            {name}
          </h1>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-black/40">Share:</span>
        <button onClick={() => share(1, '1 hour')} disabled={pending} className="btn-ghost">
          1 hour
        </button>
        <button onClick={() => share(24, '24 hours')} disabled={pending} className="btn-ghost">
          24 hours
        </button>
        <button onClick={() => share(168, '7 days')} disabled={pending} className="btn-ghost">
          7 days
        </button>
        {shared && (
          <button onClick={stopSharing} disabled={pending} className="btn-ghost text-[color:var(--stop)]">
            Stop sharing
          </button>
        )}
        <span className="mx-1 h-4 w-px bg-black/10" aria-hidden />
        <button onClick={exportTxt} className="btn-ghost">
          Export .txt
        </button>

        {/* Destructive action tucked into an overflow menu, away from benign buttons,
            so Delete is never one accidental click from Export. Esc + click-out close it. */}
        <details className="relative">
          <summary className="btn-ghost inline-flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
            ⋯
          </summary>
          <div className="glass absolute right-0 z-20 mt-2 w-44 rounded-xl p-1 shadow-lg">
            <button
              onClick={remove}
              disabled={pending}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[color:var(--stop)] hover:bg-black/5"
            >
              Delete transcript
            </button>
          </div>
        </details>
        {msg && <span className="text-[color:var(--signal)]">{msg}</span>}
      </div>
    </div>
  )
}
