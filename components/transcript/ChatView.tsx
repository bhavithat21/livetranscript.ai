'use client'
import { useEffect, useMemo, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import { colorMap, segmentSlot } from '@/lib/room/roomStore'
import { paragraphize, splitSentences, type Segment } from '@/lib/transcript/store'
import { useThemeMode } from '@/lib/transcript/useThemeMode'
import type { SpeakerOverrides } from './TranscriptView'

// Chat-bubble view of a meeting transcript. Consecutive lines from the same
// speaker are grouped under one name label, then split into a bubble per
// paragraph — so an uninterrupted monologue reads as a stack of scannable
// messages instead of one wall. Auto-scrolls to the newest message.
export function ChatView({
  segments,
  theme: themeProp,
  fill = false,
  overrides,
  scale = 1,
}: {
  segments: Segment[]
  // Optional override; omit it to follow the app-wide theme (see TranscriptView).
  theme?: 'light' | 'dark'
  fill?: boolean
  overrides?: SpeakerOverrides
  scale?: number
}) {
  const globalTheme = useThemeMode().theme
  const theme = themeProp ?? globalTheme
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [segments])

  // Color by SENDER identity, exactly as TranscriptView does. The wire `speaker`
  // field races the roster and can arrive equal for everyone — coloring by it
  // painted every bubble with slot 0, so the chat tab lost speaker distinction
  // entirely. MUST run before the early return (Rules of Hooks).
  const colors = useMemo(() => colorMap(segments), [segments])

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
          const speaker = speakerColor(ov?.colorSlot ?? segmentSlot(g.segments[0], colors), theme)
          const name = ov?.name?.trim() || g.name?.trim() || speaker.name
          return (
            <div key={g.key} className="flex flex-col gap-2">
              <span
                className="px-1 font-[family-name:var(--font-serif)] text-sm font-semibold"
                style={{ color: speaker.color }}
              >
                {name}
              </span>
              {/* One bubble per paragraph — a break lands wherever the speaker
                  paused ~2s or the block ran long, so a monologue is scannable.
                  A whitespace-only interim would otherwise render an empty bubble. */}
              {paragraphize(g.segments).filter((p) => p.text).map((p) => (
                <div
                  key={p.key}
                  className="glass flex max-w-[85%] flex-col gap-1 self-start rounded-2xl rounded-tl-md px-4 py-2.5 leading-relaxed"
                  // 1rem bubble base × the reader's text-size multiplier.
                  style={{ borderLeft: `3px solid ${speaker.color}`, opacity: p.isFinal ? 1 : 0.75, fontSize: `${scale}rem` }}
                >
                  {/* One statement per line inside the bubble instead of a run-on paragraph. */}
                  {splitSentences(p.text).map((line, li) => (
                    <p key={li} className="break-words">{line}</p>
                  ))}
                </div>
              ))}
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
