'use client'
import { useEffect, useMemo, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import { colorMap, segmentSlot } from '@/lib/room/roomStore'
import { cn } from '@/lib/utils'
import type { Segment } from '@/lib/transcript/store'

export function TranscriptView({
  segments,
  theme,
  readerMode,
  emphasizeSpeaker = null,
  autoScroll = false,
  fade = false,
  flow = false,
}: {
  segments: Segment[]
  theme: 'light' | 'dark'
  readerMode: boolean
  // Shadow Mode: this speaker's text renders big, others small + dim.
  emphasizeSpeaker?: number | null
  autoScroll?: boolean
  // Soft bottom dissolve — use when a fixed dock overlaps the scroll region.
  fade?: boolean
  // Let the PAGE own the scroll (static views like session detail) instead of a
  // capped inner scroll region (live views).
  flow?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Only follow the live edge when the reader is already near the bottom, so
  // scrolling up to re-read isn't yanked back down. Instant (not smooth) so the
  // ~10 updates/sec during speech don't stack competing animations = the jank.
  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [segments, autoScroll])

  if (segments.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-black/30">
        <p className="font-[family-name:var(--font-serif)] text-lg">
          Your transcript will appear here.
        </p>
      </div>
    )
  }

  const inkBody = theme === 'dark' ? 'text-[#f5f4f2]' : 'text-ink'
  const shadow = emphasizeSpeaker != null
  // Color by SENDER identity (consistent across all clients), not the racy wire slot.
  const colors = useMemo(() => colorMap(segments), [segments])

  return (
    <div
      ref={scrollRef}
      className={cn(!flow && 'overflow-y-auto overscroll-contain', fade && 'reading-fade')}
      style={flow ? undefined : { maxHeight: 'calc(100dvh - 72px)' }}
    >
      {/* Always a measured reading column (~70ch) — live AND reader — so lines
          never run 120+ chars on wide displays. */}
      <div className={cn('mx-auto max-w-3xl px-6', readerMode ? 'py-10' : 'py-6')}>
        {segments.map((s, i) => {
          const slot = segmentSlot(s, colors)
          const speaker = speakerColor(slot, theme)
          const color = speaker.color
          // Prefer the speaker's real display name (from Clerk) over "Speaker N".
          const name = s.name?.trim() || speaker.name
          // A new turn = the speaker changed from the previous segment. Only then do
          // we print the label + add a gap, so consecutive lines from ONE speaker
          // group into a turn instead of every line re-labelling and running on.
          const prev = segments[i - 1]
          const prevSlot = prev ? segmentSlot(prev, colors) : -999
          const prevSender = prev?.sender
          const newTurn = i === 0 || prevSlot !== slot || prevSender !== s.sender

          if (shadow) {
            const emphasized = slot === emphasizeSpeaker
            return (
              <p
                key={s.id}
                className={cn(
                  inkBody,
                  emphasized
                    ? 'text-3xl font-medium leading-snug transition-all sm:text-4xl'
                    : 'text-base leading-relaxed transition-all',
                  newTurn ? 'mt-5' : 'mt-1',
                )}
                style={{ opacity: emphasized ? (s.isFinal ? 1 : 0.6) : 0.4 }}
              >
                {newTurn && s.speaker != null && (
                  <span
                    className="mr-2 align-middle font-[family-name:var(--font-serif)] text-sm font-semibold"
                    style={{ color }}
                  >
                    {name}
                  </span>
                )}
                <span>{s.text}</span>
              </p>
            )
          }

          return (
            <div key={s.id} className={cn(newTurn ? 'mt-6 first:mt-0' : 'mt-1')}>
              {newTurn && s.speaker != null && (
                // Turn header: speaker identity carried by COLOR on the label; a thin
                // colored rule anchors the whole turn to that speaker.
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="font-[family-name:var(--font-serif)] text-sm font-semibold"
                    style={{ color }}
                  >
                    {name}
                  </span>
                  <span className="h-px flex-1" style={{ background: `${color}22` }} aria-hidden />
                </div>
              )}
              <p
                className={cn('text-lg leading-relaxed transition-opacity', inkBody)}
                style={{
                  opacity: s.isFinal ? 1 : 0.55,
                  borderLeft: s.speaker != null ? `2px solid ${color}33` : undefined,
                  paddingLeft: s.speaker != null ? '0.75rem' : undefined,
                }}
              >
                {s.text}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
