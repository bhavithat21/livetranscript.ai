'use client'

import { useState } from 'react'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import type { RemoteSessionClient, RemoteSnapshot } from '@/lib/remote/client'
import { parseRemoteNote, REMOTE_NOTE_HISTORY_LIMIT, REMOTE_NOTE_MAX_CHARS } from '@/lib/remote/protocol'

export function RemoteNotes({ client, snapshot }: {
  client: RemoteSessionClient | null
  snapshot: RemoteSnapshot
}) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const ready = snapshot.status === 'connected' && Boolean(snapshot.display) && Boolean(client)

  return (
    <section aria-labelledby="remote-notes-heading" className="mt-5 space-y-4 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="remote-notes-heading" className="flex items-center gap-2 text-lg font-semibold"><MessageSquare size={20} aria-hidden /> Session notes</h2>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">Exchange notes with the approved participant, including while screen access is view only.</p>
        </div>
        <button type="button" className="btn-ghost gap-2 text-sm" disabled={!snapshot.notes.length && !draft} onClick={() => {
          client?.clearNotes()
          setDraft('')
          setNotice('Notes cleared on this device. The other participant keeps their copy until they clear it or the session ends.')
        }}><Trash2 size={14} aria-hidden /> Clear on this device</button>
      </div>

      <div role="log" aria-label="Session note history" aria-live="polite" aria-relevant="additions" className="reader-surface max-h-80 space-y-3 overflow-y-auto rounded-lg border border-[color:var(--line)] p-4">
        {snapshot.notes.length ? snapshot.notes.map((note) => (
          <article key={note.id} className="border-b border-[color:var(--line)] pb-3 last:border-0 last:pb-0">
            <p className="mb-1 text-xs font-semibold text-[color:var(--signal)]">{note.senderName}{note.sender === snapshot.role ? ' · You' : ''}</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-ph-no-capture>{note.text}</p>
          </article>
        )) : <p className="text-sm text-[color:var(--muted)]">No notes yet. Send a question, explanation or next step.</p>}
      </div>

      <form noValidate className="space-y-2" onSubmit={(event) => {
        event.preventDefault()
        if (!parseRemoteNote({ type: 'note', seq: 1, text: draft })) {
          setNotice(`Enter a readable note of up to ${REMOTE_NOTE_MAX_CHARS.toLocaleString()} characters. Empty notes and control characters are not supported.`)
          return
        }
        if (!client?.sendNote(draft)) {
          setNotice('The note was not sent. Check the connection or wait a few seconds, then try again. Your draft is still here.')
          return
        }
        setDraft('')
        setNotice('Note sent to the connected participant.')
      }}>
        <label htmlFor="remote-note-draft" className="block text-sm font-medium">Note to {snapshot.role === 'host' ? 'your helper' : 'the laptop owner'}</label>
        <textarea id="remote-note-draft" value={draft} onChange={(event) => { setDraft(event.target.value); setNotice('') }} rows={3} maxLength={REMOTE_NOTE_MAX_CHARS} autoComplete="off" data-ph-no-capture aria-describedby="remote-note-help" className="resize-none w-full rounded-lg border border-[color:var(--line)] bg-transparent p-3 text-sm" placeholder="Type a note, then choose Send note…" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id="remote-note-help" className="text-xs text-[color:var(--muted)]">{draft.length.toLocaleString()} / {REMOTE_NOTE_MAX_CHARS.toLocaleString()} characters · Sent only when you choose Send note.</p>
          <button type="submit" className="btn-signal gap-2 text-sm" disabled={!ready || !draft.trim()}><Send size={14} aria-hidden /> Send note</button>
        </div>
      </form>
      <p role="status" className="min-h-5 text-sm leading-relaxed text-[color:var(--muted)]">{notice || (!ready ? 'Waiting for the approved connection to finish opening…' : '')}</p>
      <p className="border-t border-[color:var(--line)] pt-3 text-xs leading-relaxed text-[color:var(--muted)]">The latest {REMOTE_NOTE_HISTORY_LIMIT} notes are kept in memory on each device. Ending the session or leaving this page clears them. Notes never type into the shared laptop.</p>
    </section>
  )
}
