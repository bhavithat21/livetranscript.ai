'use client'
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

// Speech-shadowing follow-along. Shows the source text and highlights a rolling
// BAND of a few words (Otter-style) around where the repeater is — driven by
// their voice via alignIndex. Everything else stays legible: dimmed by OPACITY
// only, no blur, so context is never lost.
//
// SMOOTHNESS: the word text NEVER changes (no scramble → no per-tick width
// reflow → no vibration), and only compositor-friendly props animate (opacity,
// color, background, transform) on a short critically-damped tween (no spring
// overshoot → no wobble).

const DEFAULT_WINDOW = 4 // rolling highlight band size (clamped to 3–5)

type WordState = 'lead' | 'band' | 'past' | 'upcoming'

interface ShadowFollowProps {
  words: string[]
  activeIndex: number
  /** How many words to highlight at once (3–5). */
  windowSize?: number
  theme?: 'light' | 'dark'
  className?: string
}

export function ShadowFollow({
  words,
  activeIndex,
  windowSize = DEFAULT_WINDOW,
  theme = 'light',
  className,
}: ShadowFollowProps) {
  const leadRef = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const w = Math.min(5, Math.max(3, windowSize))

  // Keep the highlighted band in view as the repeater advances.
  useEffect(() => {
    leadRef.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [activeIndex, reduce])

  return (
    <div className={cn('flex flex-wrap gap-x-1 gap-y-2 leading-relaxed', className)}>
      {words.map((word, i) => {
        // Band runs FORWARD from the current word: the phrase to say now.
        const state: WordState =
          i === activeIndex
            ? 'lead'
            : i > activeIndex && i < activeIndex + w
              ? 'band'
              : i < activeIndex
                ? 'past'
                : 'upcoming'
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
const HL_BG = 'rgba(15,118,110,0.14)' // soft emerald highlight behind the band
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
  state: WordState
  theme: 'light' | 'dark'
  reduce: boolean
}) {
  const highlighted = state === 'lead' || state === 'band'

  return (
    <motion.span
      ref={spanRef}
      // Constant padding + font-weight so ONLY paint/composite props animate — no
      // layout change means no reflow of neighbors (that was the "vibration").
      className="inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 font-[family-name:var(--font-body)] font-medium"
      // Promote to its own GPU layer so scaling the glyphs is a texture transform
      // (smooth) rather than a per-frame re-rasterization (shimmer).
      style={{ transformOrigin: 'center bottom', willChange: 'transform, opacity' }}
      initial={false}
      animate={{
        scale: state === 'lead' ? 1.1 : 1,
        opacity: highlighted ? 1 : state === 'past' ? 0.4 : 0.6,
        color: highlighted ? INK[theme] : state === 'past' ? EMERALD : INK[theme],
        backgroundColor: highlighted ? HL_BG : NO_BG,
      }}
      // Short critically-damped tween — settles without spring overshoot/wobble.
      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {word}
    </motion.span>
  )
}
