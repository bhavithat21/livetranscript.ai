'use client'
import { useEffect, useMemo, useRef } from 'react'
import { speakerColor } from '@/lib/speakers/palette'
import { colorMap, segmentSlot } from '@/lib/room/roomStore'
import { cn } from '@/lib/utils'
import { splitSentences, type Segment } from '@/lib/transcript/store'

// Sentences for a segment; never empty so a blank/whitespace interim still holds
// its place in the list (avoids a line vanishing then reappearing mid-speech).
function sentencesOf(s: Segment): string[] {
  const lines = splitSentences(s.text)
  return lines.length ? lines : ['']
}

export function TranscriptView({
  segments,
  theme,
  readerMode,
  emphasizeSpeaker = null,
  autoScroll = false,
  fade = false,
  flow = false,
  fill = false,
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
  // Fill the parent's height (h-full) instead of a fixed 100dvh cap — use inside
  // a flex column so there's exactly one scrollbar (no page + inner double scroll).
  fill?: boolean
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

  // Color by SENDER identity (consistent across all clients), not the racy wire
  // slot. MUST run before any early return — Rules of Hooks: an early return that
  // skips this hook changes the hook count when the first segment arrives and
  // crashes the component (that was kicking everyone out of live meetings).
  const colors = useMemo(() => colorMap(segments), [segments])

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
      className={cn(
        !flow && 'overflow-y-auto overscroll-contain',
        fill && 'h-full',
        fade && 'reading-fade',
      )}
      // fill → grow to the flex parent (one scrollbar); else the legacy 100dvh cap.
      style={flow || fill ? undefined : { maxHeight: 'calc(100dvh - 72px)' }}
    >
      {/* Always a measured reading column (~70ch) — live AND reader — so lines
          never run 120+ chars on wide displays. Live views (fade/fill) carry a
          fixed bottom dock, so pad the column so the last lines clear it instead
          of scrolling behind the controls. */}
      <div
        className={cn(
          'mx-auto max-w-3xl px-6',
          readerMode ? 'pt-10' : 'pt-6',
          fade || fill ? 'pb-40' : readerMode ? 'pb-10' : 'pb-6',
        )}
      >
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
              <div key={s.id} className={cn(newTurn ? 'mt-5' : 'mt-1')}>
                {newTurn && s.speaker != null && (
                  <span
                    className="mb-0.5 block font-[family-name:var(--font-serif)] text-sm font-semibold"
                    style={{ color }}
                  >
                    {name}
                  </span>
                )}
                {/* One statement per line so the person repeating reads a clean
                    sentence at a time rather than chasing a run-on block. */}
                {sentencesOf(s).map((line, li) => (
                  <p
                    key={li}
                    className={cn(
                      inkBody,
                      emphasized
                        ? 'text-3xl font-medium leading-snug transition-all sm:text-4xl'
                        : 'text-base leading-relaxed transition-all',
                    )}
                    style={{ opacity: emphasized ? (s.isFinal ? 1 : 0.6) : 0.4 }}
                  >
                    {line}
                  </p>
                ))}
              </div>
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
              {/* One statement per line — split the turn into sentences so it
                  reads (and repeats) cleanly instead of one run-on block. */}
              <div
                className="flex flex-col gap-1"
                style={{
                  borderLeft: s.speaker != null ? `2px solid ${color}33` : undefined,
                  paddingLeft: s.speaker != null ? '0.75rem' : undefined,
                }}
              >
                {sentencesOf(s).map((line, li) => (
                  <p
                    key={li}
                    className={cn('text-lg leading-relaxed transition-opacity', inkBody)}
                    style={{ opacity: s.isFinal ? 1 : 0.55 }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
