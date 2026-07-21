'use client'
import { useEffect, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import { splitSentences, type Segment } from '@/lib/transcript/store'

// Chat-bubble view of a meeting transcript. Consecutive lines from the same
// speaker are grouped into one bubble, labeled with their display name (from
// login) and colored by speaker slot. Auto-scrolls to the newest message.
export function ChatView({
  segments,
  theme = 'light',
  fill = false,
}: {
  segments: Segment[]
  theme?: 'light' | 'dark'
  fill?: boolean
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
          const speaker = speakerColor(g.speaker ?? 0, theme)
          const name = g.name?.trim() || speaker.name
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
                style={{ borderLeft: `3px solid ${speaker.color}`, opacity: pending ? 0.75 : 1 }}
              >
                {/* One statement per line inside the bubble instead of a run-on paragraph. */}
                {splitSentences(g.segments.map((s) => s.text).join(' ')).map((line, li) => (
                  <p key={li}>{line}</p>
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

// Merge consecutive segments from the same sender (or same speaker slot when
// there's no sender, e.g. single-mic) into one chat bubble.
function groupBySpeaker(segments: Segment[]): Group[] {
  const groups: Group[] = []
  for (const s of segments) {
    const prev = groups[groups.length - 1]
    const sameSpeaker = prev && (s.sender ? prev.segments[0].sender === s.sender : prev.speaker === s.speaker)
    if (sameSpeaker) {
      prev.segments.push(s)
    } else {
      groups.push({ key: String(s.id), speaker: s.speaker, name: s.name, segments: [s] })
    }
  }
  return groups
}
