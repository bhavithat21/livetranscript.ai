'use client'
import { useEffect, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import type { Segment } from '@/lib/transcript/store'

const INK = '#16151a'

export function TranscriptView({
  segments,
  theme,
  readerMode,
  emphasizeSpeaker = null,
  autoScroll = false,
}: {
  segments: Segment[]
  theme: 'light' | 'dark'
  readerMode: boolean
  // Shadow Mode: this speaker's text renders big + dark, others small + dim.
  emphasizeSpeaker?: number | null
  autoScroll?: boolean
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

  const shadow = emphasizeSpeaker != null

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto overscroll-contain"
      style={{ maxHeight: 'calc(100dvh - 72px)' }}
    >
      <div className={readerMode ? 'mx-auto max-w-3xl px-6 py-10' : 'px-6 py-4'}>
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
              className={
                emphasized
                  ? 'mb-5 text-3xl font-medium leading-snug transition-all sm:text-4xl'
                  : 'mb-3 text-base leading-relaxed transition-all'
              }
              style={{
                color: emphasized ? INK : undefined,
                opacity: emphasized ? (s.isFinal ? 1 : 0.6) : 0.4,
              }}
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
            className="mb-4 text-lg leading-relaxed transition-opacity"
            style={{ opacity: s.isFinal ? 1 : 0.55 }}
          >
            {s.speaker != null && (
              <span
                className="mr-2 font-[family-name:var(--font-serif)] text-sm font-semibold"
                style={{ color }}
              >
                {name}
              </span>
            )}
            <span style={readerMode ? { color } : undefined}>{s.text}</span>
          </p>
        )
      })}
      </div>
    </div>
  )
}
