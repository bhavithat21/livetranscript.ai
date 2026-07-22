'use client'
import { useState } from 'react'
import { Check, Headphones, Mic, Pencil, Volume2, X } from 'lucide-react'
import { speakerColor } from '@/lib/speakers/palette'
import { MAX_SPEAKERS } from '@/lib/room/roomStore'
import type { RoomMember } from '@/lib/room/useRoom'
import type { SpeakerPrefs, SpeakerPref } from '@/lib/room/useSpeakerPrefs'

// "Who's in the meeting" — one row per participant: the color you see them in,
// their name (your local override, else their login name), and the audio source
// they're capturing. Pencil opens inline editing of name + color for THAT person,
// saved only on your device (never broadcast).
export function RosterPanel({
  members,
  myClientId,
  prefs,
  setPref,
  onClose,
}: {
  members: RoomMember[]
  myClientId: string
  prefs: SpeakerPrefs
  setPref: (clientId: string, patch: SpeakerPref) => void
  onClose: () => void
}) {
  return (
    <div className="glass absolute right-3 top-16 z-50 flex max-h-[calc(100dvh-6rem)] w-[min(18rem,calc(100vw-1.5rem))] flex-col rounded-2xl p-2 shadow-lg">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-sm font-semibold">In this meeting · {members.length}</span>
        <button
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full text-black/40 hover:bg-black/5"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="flex flex-col overflow-y-auto">
        {members.map((m) => (
          <MemberRow
            key={m.clientId}
            member={m}
            isMe={m.clientId === myClientId}
            pref={prefs[m.clientId]}
            setPref={setPref}
          />
        ))}
      </ul>
    </div>
  )
}

const SOURCE_META = {
  mic: { icon: Mic, label: 'Microphone' },
  system: { icon: Volume2, label: 'System audio' },
  listening: { icon: Headphones, label: 'Listening' },
} as const

function MemberRow({
  member,
  isMe,
  pref,
  setPref,
}: {
  member: RoomMember
  isMe: boolean
  pref?: SpeakerPref
  setPref: (clientId: string, patch: SpeakerPref) => void
}) {
  const [editing, setEditing] = useState(false)
  const slot = pref?.colorSlot ?? (member.slot < 0 ? 0 : member.slot)
  const speaker = speakerColor(slot, 'light')
  const name = pref?.name?.trim() || member.name?.trim() || speaker.name
  const src = SOURCE_META[member.source ?? 'listening']
  const SourceIcon = src.icon
  const [draft, setDraft] = useState(name)

  if (editing) {
    return (
      <li className="rounded-xl bg-black/[0.03] px-2 py-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPref(member.clientId, { name: draft })
            setEditing(false)
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={40}
            className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-700"
            placeholder="Name"
          />
          <button
            type="submit"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white"
            aria-label="Save"
          >
            <Check size={15} />
          </button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {Array.from({ length: MAX_SPEAKERS }, (_, i) => {
            const c = speakerColor(i, 'light').color
            return (
              <button
                key={i}
                onClick={() => setPref(member.clientId, { colorSlot: i })}
                data-active={i === slot}
                className="flex h-11 w-11 items-center justify-center rounded-full sm:h-9 sm:w-9"
                aria-label={`Color ${i + 1}`}
              >
                <span
                  className="h-6 w-6 rounded-full ring-offset-1 transition-transform active:scale-110 data-[active=true]:ring-2 data-[active=true]:ring-black/40"
                  data-active={i === slot}
                  style={{ background: c }}
                />
              </button>
            )
          })}
        </div>
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-black/[0.03]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: speaker.color }} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {name}
        {isMe && <span className="ml-1 text-black/40">(you)</span>}
      </span>
      <span className="flex items-center gap-1 text-xs text-black/45" title={src.label}>
        <SourceIcon size={14} />
        <span className="hidden sm:inline">{src.label}</span>
      </span>
      {/* Visible by default on touch (no hover there); hover-reveal only on
          pointer/desktop. 44px hit area. */}
      <button
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-black/40 opacity-100 transition-opacity hover:bg-black/5 hover:text-black/70 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Edit name and color"
      >
        <Pencil size={15} />
      </button>
    </li>
  )
}
