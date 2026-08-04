'use client'
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { bandWordCount, wordState, type ShadowWordState } from '@/lib/room/shadowAlign'
import { useThemeMode } from '@/lib/transcript/useThemeMode'

// Speech-shadowing follow-along, "growing trail" model. Shows the whole recent
// passage and marks what's been SAID SO FAR with a continuous colored underline
// that grows word-by-word as the reader advances (driven by their voice via
// alignIndex). The current word is bold + highlighted ("what we're saying now"),
// the next few words are emphasized ("what to read next"), and everything ahead
// stays legible as context. Nothing is blurred — only dimmed by opacity.
//
// SMOOTHNESS: word text NEVER changes (no reflow/vibration); only paint/composite
// props animate (opacity, color, background, transform) on a short critically-
// damped tween (no spring overshoot → no wobble).

interface ShadowFollowProps {
  words: string[]
  activeIndex: number
  /** Override the adaptive band with a fixed word count (used by the demo). */
  windowSize?: number
  /** Optional override; omit it to follow the app-wide theme. Defaulting this to
   *  'light' rendered near-black words on the dark Follow-along overlay. */
  theme?: 'light' | 'dark'
  className?: string
}

export function ShadowFollow({
  words,
  activeIndex,
  windowSize,
  theme: themeProp,
  className,
}: ShadowFollowProps) {
  const globalTheme = useThemeMode().theme
  const theme = themeProp ?? globalTheme
  const leadRef = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  // Adaptive band: light words ahead until ~a breath-sized phrase (~1.5s of
  // speech) is covered, so dense and filler-heavy text both feel consistent. A
  // fixed windowSize still wins when explicitly passed. Count includes the lead.
  const w = windowSize ?? bandWordCount(words, activeIndex)

  // Keep the growing tip in view as the reader advances.
  useEffect(() => {
    leadRef.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [activeIndex, reduce])

  return (
    // key={theme} REMOUNTS the words when the theme flips. The word colors live in
    // motion's `animate` prop, and with `initial={false}` motion latches its
    // baseline on mount and never re-applied the color when theme changed from the
    // server snapshot ('light') to the client's real value — leaving near-black
    // words on the dark overlay while the plain-CSS borders were correctly light.
    // Remounting re-seeds those baselines. A theme toggle is rare, so losing the
    // in-flight trail animation for one frame is a fair trade.
    <div key={theme} className={cn('flex flex-wrap gap-x-1 gap-y-1.5 leading-relaxed', className)}>
      {words.map((word, i) => {
        const state = wordState(i, activeIndex, w)
        return (
          <ShadowWordItem
            key={i}
            spanRef={state === 'lead' ? leadRef : undefined}
            word={word}
            state={state}
            theme={theme}
            reduce={!!reduce}
          />
        )
      })}
    </div>
  )
}

const INK = { light: '#16151a', dark: '#f5f4f2' }
const EMERALD = '#0f766e'
const EMERALD_DK = '#5eead4'
const LEAD_BG = 'rgba(15,118,110,0.16)' // highlight behind the current word
const NO_BG = 'rgba(15,118,110,0)'

function ShadowWordItem({
  spanRef,
  word,
  state,
  theme,
  reduce,
}: {
  spanRef?: React.Ref<HTMLSpanElement>
  word: string
  state: ShadowWordState
  theme: 'light' | 'dark'
  reduce: boolean
}) {
  const trail = theme === 'dark' ? EMERALD_DK : EMERALD
  // covered = the growing marked trail: full-strength emerald + a continuous
  // underline (per-word borders abut into one line as words wrap). lead = the
  // tip, bold + highlight + slight scale. band = the next words to read. upcoming
  // = faint context the speaker already said.
  const isCovered = state === 'covered'
  const isLead = state === 'lead'
  const isBand = state === 'band'

  return (
    <motion.span
      ref={spanRef}
      // Constant padding + font-weight so ONLY paint/composite props animate — no
      // layout change means no reflow of neighbors (that was the "vibration").
      className="inline-block whitespace-nowrap rounded-md px-1 py-0.5 font-[family-name:var(--font-body)]"
      style={{
        transformOrigin: 'center bottom',
        willChange: 'transform, opacity',
        // The growing trail: covered + lead words carry a solid underline; they
        // sit adjacent so it reads as one continuous, lengthening mark.
        borderBottom: isCovered || isLead ? `2px solid ${trail}` : '2px solid transparent',
        fontWeight: isLead ? 700 : isCovered ? 600 : 500,
      }}
      initial={false}
      animate={{
        scale: isLead ? 1.08 : 1,
        opacity: isLead || isBand || isCovered ? 1 : 0.5,
        color: isCovered ? trail : INK[theme],
        backgroundColor: isLead ? LEAD_BG : NO_BG,
      }}
      // Short critically-damped tween — settles without spring overshoot/wobble.
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {word}
    </motion.span>
  )
}
