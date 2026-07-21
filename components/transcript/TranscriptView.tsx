'use client'
import { speakerColor } from '@/lib/speakers/palette'
import type { Segment } from '@/lib/transcript/store'

export function TranscriptView({
  segments,
  theme,
  readerMode,
}: {
  segments: Segment[]
  theme: 'light' | 'dark'
  readerMode: boolean
}) {
  if (segments.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-black/30">
        <p className="font-serif text-lg">Your transcript will appear here.</p>
      </div>
    )
  }
  return (
    <div className={readerMode ? 'mx-auto max-w-3xl px-6 py-10' : 'px-6 py-4'}>
      {segments.map((s) => {
        const { color, name } = speakerColor(s.speaker ?? 0, theme)
        return (
          <p
            key={s.id}
            className="mb-4 text-lg leading-relaxed transition-opacity"
            style={{ opacity: s.isFinal ? 1 : 0.55 }}
          >
            {s.speaker != null && (
              <span className="mr-2 font-serif text-sm font-semibold" style={{ color }}>
                {name}
              </span>
            )}
            <span style={readerMode ? { color } : undefined}>{s.text}</span>
          </p>
        )
      })}
    </div>
  )
}
