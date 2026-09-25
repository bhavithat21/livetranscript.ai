'use client'
import { readingBlocks, sameSpeaker, transcriptTime } from '@/lib/transcript/reading'
import styles from './TranscriptReader.module.css'
import { memo, useMemo } from 'react'
import { LiveScrollArea } from './LiveScrollArea'
import { speakerColor } from '@/lib/speakers/palette'
import { colorMap, segmentSlot } from '@/lib/room/roomStore'
import { cn } from '@/lib/utils'
import { paragraphize, splitSentences, type Segment } from '@/lib/transcript/store'
import { useThemeMode } from '@/lib/transcript/useThemeMode'

// Sentences for a segment; never empty so a blank/whitespace interim still holds
// its place in the list (avoids a line vanishing then reappearing mid-speech).
function sentencesOf(s: Segment): string[] {
  const lines = splitSentences(s.text)
  return lines.length ? lines : ['']
}

// Per-device overrides for how one participant is shown: a custom name and/or a
// color slot, keyed by the segment's `sender` (Ably clientId). Local only.
export type SpeakerOverride = { name?: string; colorSlot?: number }
export type SpeakerOverrides = Record<string, SpeakerOverride>

export function TranscriptView({
  segments,
  theme: themeProp,
  readerMode,
  emphasizeSpeaker = null,
  autoScroll = false,
  fade = false,
  flow = false,
  fill = false,
  overrides,
  scale = 1,
}: {
  segments: Segment[]
  // Optional override. Omit it and the view follows the app-wide theme — server
  // components (session detail, public share) can't call the hook themselves, so
  // deriving it here is what makes speaker colors correct on those pages too.
  theme?: 'light' | 'dark'
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
  // Per-device name/color overrides keyed by sender (clientId). Undefined = none.
  overrides?: SpeakerOverrides
  // Reader text-size multiplier (from useTextScale). 1 = default; scales the body
  // line font-size so people can enlarge/shrink captions for comfort.
  scale?: number
}) {
  const globalTheme = useThemeMode().theme
  const theme = themeProp ?? globalTheme
  // Color by SENDER identity (consistent across all clients), not the racy wire
  // slot. MUST run before any early return — Rules of Hooks: an early return that
  // skips this hook changes the hook count when the first segment arrives and
  // crashes the component (that was kicking everyone out of live meetings).
  const colors = useMemo(() => colorMap(segments), [segments])

  // Ids of segments that open a new paragraph WITHIN a turn (the speaker paused
  // ~2s, or the block ran long). Turn-opening segments are excluded — they already
  // get the larger turn gap. Same rule the chat tab uses, so both views break in
  // the same places. MUST stay above the early return (Rules of Hooks).
  const paragraphStarts = useMemo(() => {
    const ids = new Set<number>()
    let turn: Segment[] = []
    const flush = () => {
      // startsSegment filters out mid-segment overflow chunks, whose first
      // segment already opened the paragraph before them.
      for (const p of paragraphize(turn).slice(1)) if (p.startsSegment) ids.add(p.segments[0].id)
      turn = []
    }
    for (const s of segments) {
      if (turn.length && !sameSpeaker(turn[0], s)) flush()
      turn.push(s)
    }
    flush()
    return ids
  }, [segments])

  const blocks = useMemo(() => readingBlocks(segments), [segments])
  const turnStarts = useMemo(() => new Set(blocks.map(block => block.key)), [blocks])

  if (segments.length === 0) {
    return (
      <div className="px-4 py-16 text-center text-black/30 sm:px-6">
        <p className="font-[family-name:var(--font-serif)] text-lg">
          Your transcript will appear here.
        </p>
      </div>
    )
  }

  const inkBody = theme === 'dark' ? 'text-[#f5f4f2]' : 'text-ink'
  const shadow = emphasizeSpeaker != null

  return (
    <LiveScrollArea updateKey={segments} enabled={autoScroll} flow={flow} fade={fade} nativeScroll
      className={fill ? 'h-full' : undefined}
      style={flow || fill ? undefined : { maxHeight: 'calc(100dvh - 72px)' }}>
      {/* Always a measured reading column (~70ch) — live AND reader — so lines
          never run 120+ chars on wide displays. Live views (fade/fill) carry a
          fixed bottom dock, so pad the column so the last lines clear it instead
          of scrolling behind the controls. */}
      <div
        className={cn(
          'mx-auto max-w-3xl px-4 sm:px-6',
          readerMode ? 'pt-10' : 'pt-6',
          fade || fill ? 'pb-40' : readerMode ? 'pb-10' : 'pb-6',
        )}
      >
        {readerMode && !shadow ? blocks.map(block => {
          const first = block.first
          const ov = first.sender ? overrides?.[first.sender] : undefined
          const speaker = speakerColor(ov?.colorSlot ?? segmentSlot(first, colors), theme)
          const name = ov?.name?.trim() || first.name?.trim() || (first.speaker == null ? 'Unassigned speaker' : speaker.name)
          const time = transcriptTime(first.startMs)
          return <section key={block.key} className={styles.turn} aria-label={`${name}${time ? ', ' + time : ''}`}>
            <div className={styles.turnHeading}><span className={styles.speakerDot} style={{ backgroundColor: speaker.color }} aria-hidden /><span>{name}</span>{time && <time className={styles.timestamp}>{time}</time>}</div>
            <div className={styles.paragraphs} style={{ fontSize: `calc(clamp(1rem, .95rem + .2vw, 1.125rem) * ${scale})` }}>
              {block.paragraphs.map(paragraph => <p key={paragraph[0].id}>
                {paragraph.map((segment, index) => <span key={segment.id} data-interim={!segment.isFinal || undefined} title={!segment.isFinal ? 'Unfinalized recognition — not confirmed by the speech engine' : segment.confidence != null && segment.confidence < .8 ? 'Low speech-recognition confidence. Check the audio before relying on this wording.' : undefined}>{index > 0 ? ' ' : ''}{segment.text.trim()}{!segment.isFinal && <small className={styles.pending}>Unfinalized</small>}</span>)}
              </p>)}
            </div>
          </section>
        }) : segments.map((s) => {
          const ov = s.sender ? overrides?.[s.sender] : undefined
          // Override color slot wins, else the receiver-derived consistent slot.
          const slot = ov?.colorSlot ?? segmentSlot(s, colors)
          const speaker = speakerColor(slot, theme)
          // Name priority: your local override → the speaker's login name → "Speaker N".
          const name = ov?.name?.trim() || s.name?.trim() || speaker.name
          // A new turn = the speaker changed from the previous segment. Only then do
          // we print the label + add a gap, so consecutive lines from ONE speaker
          // group into a turn instead of every line re-labelling and running on.
          // Group turns by SENDER (stable identity) — with a colorSlot override two
          // people could share a color, so sender is the correct turn boundary.
          const newTurn = turnStarts.has(s.id)
          // Only the trailing interim changes on each ASR tick; a memoized row with
          // primitive props lets React skip re-rendering (and re-splitting) every
          // other line — the difference between smooth and janky in long sessions.
          return (
            <TranscriptRow
              key={s.id}
              segment={s}
              color={speaker.color}
              name={name}
              newTurn={newTurn}
              newParagraph={paragraphStarts.has(s.id)}
              inkBody={inkBody}
              scale={scale}
              shadow={shadow}
              emphasized={shadow && slot === emphasizeSpeaker}
            />
          )
        })}
      </div>
    </LiveScrollArea>
  )
}

// One transcript turn/line. Memoized on primitive props so the ~10 ASR ticks/sec
// only re-render (and re-split) the trailing interim segment, not the whole list.
const TranscriptRow = memo(function TranscriptRow({
  segment: s,
  color,
  name,
  newTurn,
  newParagraph,
  inkBody,
  scale,
  shadow,
  emphasized,
}: {
  segment: Segment
  color: string
  name: string
  newTurn: boolean
  // Opens a paragraph inside an ongoing turn — render with breathing room so a
  // long monologue reads as blocks rather than one unbroken run.
  newParagraph: boolean
  inkBody: string
  scale: number
  shadow: boolean
  emphasized: boolean
}) {
  if (shadow) {
    return (
      <div className={cn(newTurn ? 'mt-5' : newParagraph ? 'mt-4' : 'mt-1')}>
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
              'break-words',
              emphasized ? 'font-medium leading-snug transition-all' : 'leading-relaxed transition-all',
            )}
            // Emphasized shadow line ~2rem base; non-emphasized 1rem — both × scale.
            style={{
              opacity: emphasized ? (s.isFinal ? 1 : 0.6) : 0.4,
              fontSize: `${(emphasized ? 2 : 1) * scale}rem`,
            }}
          >
            {line}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className={cn(newTurn ? 'mt-6 first:mt-0' : newParagraph ? 'mt-4' : 'mt-1')}>
      {newTurn && s.speaker != null && (
        // Turn header: speaker identity carried by COLOR on the label; a thin
        // colored rule anchors the whole turn to that speaker.
        <div className="mb-1 flex items-center gap-2">
          <span
            className="min-w-0 break-words font-[family-name:var(--font-serif)] text-sm font-semibold"
            style={{ color }}
          >
            {name}
          </span>
          <span className="h-px flex-1 shrink-0" style={{ background: `${color}22` }} aria-hidden />
        </div>
      )}
      {/* One statement per line — split the turn into sentences so it
          reads (and repeats) cleanly instead of one run-on block. */}
      <div
        className="flex min-w-0 flex-col gap-1"
        style={{
          borderLeft: s.speaker != null ? `2px solid ${color}33` : undefined,
          paddingLeft: s.speaker != null ? '0.75rem' : undefined,
        }}
      >
        {sentencesOf(s).map((line, li) => (
          <p
            key={li}
            // text-lg (1.125rem) base × the reader's scale multiplier.
            className={cn('break-words leading-relaxed transition-opacity', inkBody)}
            style={{ opacity: s.isFinal ? 1 : 0.55, fontSize: `${1.125 * scale}rem` }}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  )
})
