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
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
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
    <div className={readerMode ? 'mx-auto max-w-3xl px-6 py-10' : 'px-6 py-4'}>
      {segments.map((s) => {
        const { color, name } = speakerColor(s.speaker ?? 0, theme)

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
      <div ref={bottomRef} />
    </div>
  )
}
