'use client'
import { useEffect, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import { splitSentences, type Segment } from '@/lib/transcript/store'
import type { SpeakerOverrides } from './TranscriptView'

// Chat-bubble view of a meeting transcript. Consecutive lines from the same
// speaker are grouped into one bubble, labeled with their display name (from
// login) and colored by speaker slot. Auto-scrolls to the newest message.
export function ChatView({
  segments,
  theme = 'light',
  fill = false,
  overrides,
  scale = 1,
}: {
  segments: Segment[]
  theme?: 'light' | 'dark'
  fill?: boolean
  overrides?: SpeakerOverrides
  scale?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [segments])

  if (segments.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-black/30">
        <p className="font-[family-name:var(--font-serif)] text-lg">Messages will appear here.</p>
      </div>
    )
  }

  const groups = groupBySpeaker(segments)

  return (
    <div
      ref={scrollRef}
      className={fill ? 'h-full overflow-y-auto overscroll-contain' : 'overflow-y-auto overscroll-contain'}
      style={fill ? undefined : { maxHeight: 'calc(100dvh - 160px)' }}
    >
      {/* pb-40 so the last bubble clears the fixed bottom control dock. */}
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 pt-8 pb-40">
        {groups.map((g) => {
          const sender = g.segments[0].sender
          const ov = sender ? overrides?.[sender] : undefined
          const speaker = speakerColor(ov?.colorSlot ?? g.speaker ?? 0, theme)
          const name = ov?.name?.trim() || g.name?.trim() || speaker.name
          const pending = g.segments.some((s) => !s.isFinal)
          return (
            <div key={g.key} className="flex flex-col gap-1">
              <span
                className="px-1 font-[family-name:var(--font-serif)] text-sm font-semibold"
                style={{ color: speaker.color }}
              >
                {name}
              </span>
              <div
                className="glass flex max-w-[85%] flex-col gap-1 self-start rounded-2xl rounded-tl-md px-4 py-2.5 leading-relaxed"
                // 1rem bubble base × the reader's text-size multiplier.
                style={{ borderLeft: `3px solid ${speaker.color}`, opacity: pending ? 0.75 : 1, fontSize: `${scale}rem` }}
              >
                {/* One statement per line inside the bubble instead of a run-on paragraph. */}
                {splitSentences(g.segments.map((s) => s.text).join(' ')).map((line, li) => (
                  <p key={li} className="break-words">{line}</p>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Group = { key: string; speaker: number | null; name?: string; segments: Segment[] }

const SILENCE_BREAK_MS = 2000
const TIME_BREAK_MS = 30000

// Merge consecutive segments from the same sender into one chat bubble,
// but force a paragraph break on: speaker change, >2s silence, or >30s continuous.
function groupBySpeaker(segments: Segment[]): Group[] {
  const groups: Group[] = []
  for (const s of segments) {
    const prev = groups[groups.length - 1]
    const sameSpeaker = prev && (s.sender ? prev.segments[0].sender === s.sender : prev.speaker === s.speaker)
    let forceBreak = false
    if (sameSpeaker && s.startMs != null) {
      const lastSeg = prev.segments[prev.segments.length - 1]
      const gap = lastSeg.endMs != null ? s.startMs - lastSeg.endMs : 0
      if (gap >= SILENCE_BREAK_MS) forceBreak = true
      const groupStart = prev.segments[0].startMs
      if (groupStart != null && s.startMs - groupStart >= TIME_BREAK_MS) forceBreak = true
    }
    if (sameSpeaker && !forceBreak) {
      prev.segments.push(s)
    } else {
      groups.push({ key: String(s.id), speaker: s.speaker, name: s.name, segments: [s] })
    }
  }
  return groups
}
