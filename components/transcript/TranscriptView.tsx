'use client'
import { useEffect, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import { cn } from '@/lib/utils'
import type { Segment } from '@/lib/transcript/store'

export function TranscriptView({
  segments,
  theme,
  readerMode,
  emphasizeSpeaker = null,
  autoScroll = false,
  fade = false,
}: {
  segments: Segment[]
  theme: 'light' | 'dark'
  readerMode: boolean
  // Shadow Mode: this speaker's text renders big, others small + dim.
  emphasizeSpeaker?: number | null
  autoScroll?: boolean
  // Soft bottom dissolve — use when a fixed dock overlaps the scroll region.
  fade?: boolean
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

  return (
    <div
      ref={scrollRef}
      className={cn('overflow-y-auto overscroll-contain', fade && 'reading-fade')}
      style={{ maxHeight: 'calc(100dvh - 72px)' }}
    >
      {/* Always a measured reading column (~70ch) — live AND reader — so lines
          never run 120+ chars on wide displays. */}
      <div className={cn('mx-auto max-w-3xl px-6', readerMode ? 'py-10' : 'py-6')}>
        {segments.map((s) => {
          const speaker = speakerColor(s.speaker ?? 0, theme)
          const color = speaker.color
          // Prefer the speaker's real display name (from Clerk) over "Speaker N".
          const name = s.name?.trim() || speaker.name

          if (shadow) {
            const emphasized = s.speaker === emphasizeSpeaker
            return (
              <p
                key={s.id}
                className={cn(
                  inkBody,
                  emphasized
                    ? 'mb-5 text-3xl font-medium leading-snug transition-all sm:text-4xl'
                    : 'mb-3 text-base leading-relaxed transition-all',
                )}
                style={{ opacity: emphasized ? (s.isFinal ? 1 : 0.6) : 0.4 }}
              >
                {s.speaker != null && (
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
            <p
              key={s.id}
              className={cn('mb-4 text-lg leading-relaxed transition-opacity', inkBody)}
              style={{ opacity: s.isFinal ? 1 : 0.55 }}
            >
              {s.speaker != null && (
                // Speaker identity is carried by COLOR on the label only — the body
                // text stays ink for maximum contrast (the #1 product value).
                <span
                  className="mr-2 font-[family-name:var(--font-serif)] text-sm font-semibold"
                  style={{ color }}
                >
                  {name}
                </span>
              )}
              <span>{s.text}</span>
            </p>
          )
        })}
      </div>
    </div>
  )
}
