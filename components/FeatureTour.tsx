'use client'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'

// A lightweight, dependency-free feature tour: dims the page, spotlights one
// element at a time (by its data-tour attribute), and shows a tooltip explaining
// it. Auto-runs once for a new user (localStorage flag) and can be relaunched any
// time by dispatching `window.dispatchEvent(new Event('lt:start-tour'))` — the
// Help "?" sheet / a menu item can fire that.
//
// Steps whose target isn't on the current page are skipped, so the same tour
// definition works across routes without breaking. No library: the cutout is one
// absolutely-positioned box with a huge box-shadow, the tooltip is one div.

interface TourStep {
  target: string // data-tour value
  title: string
  body: string
}

// The real features, in the order a new user should meet them. Anchors live in
// AppNav (present on the marketing + library surfaces).
const STEPS: readonly TourStep[] = [
  {
    target: 'record',
    title: 'Start a transcript',
    body: 'Capture live audio — your mic or system/tab audio — and get real-time captions with speaker labels.',
  },
  {
    target: 'room',
    title: 'Multi-party rooms',
    body: 'Spin up a shared room so several people can join and everyone’s speech is transcribed and labelled live.',
  },
  {
    target: 'library',
    title: 'Your library',
    body: 'Every session is saved here with its summary, key points and action items — searchable and shareable.',
  },
  {
    target: 'download',
    title: 'Desktop app',
    body: 'Install the native app for silent system-audio capture, a menu-bar tray, and a global panic-hide hotkey.',
  },
] as const

const SEEN_KEY = 'lt.tourSeen'
const PADDING = 8 // px of breathing room around the spotlighted element

// Clerk without a mounted provider (preview/browser build) throws from useUser;
// degrade to "no user" so the tour falls back to localStorage-only tracking.
function useUserSafe() {
  try {
    return useUser()
  } catch {
    return { isLoaded: false, isSignedIn: false, user: null } as const
  }
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export function FeatureTour() {
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const { isLoaded, isSignedIn, user } = useUserSafe()

  const stop = useCallback(() => {
    setActive(false)
    // Per-USER when signed in: persist to Clerk so the tour never re-shows on a
    // new device/browser. Also mirror to localStorage for instant checks + the
    // signed-out/preview case. Fire-and-forget; a failed write just risks one
    // extra tour next visit.
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode — falls back to Clerk metadata or re-runs, harmless */
    }
    if (isSignedIn && user && user.unsafeMetadata?.tourSeen !== true) {
      user
        .update({ unsafeMetadata: { ...user.unsafeMetadata, tourSeen: true } })
        .catch(() => {})
    }
  }, [isSignedIn, user])

  // Find the target for a step; skip forward over any that aren't on this page.
  // Returns the resolved element or null if none of the remaining steps exist.
  const resolveFrom = useCallback((from: number): { index: number; el: Element } | null => {
    for (let i = from; i < STEPS.length; i++) {
      const el = document.querySelector(`[data-tour="${STEPS[i].target}"]`)
      if (el) return { index: i, el }
    }
    return null
  }, [])

  const goTo = useCallback(
    (from: number) => {
      const found = resolveFrom(from)
      if (!found) {
        stop()
        return
      }
      const r = found.el.getBoundingClientRect()
      setStep(found.index)
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    },
    [resolveFrom, stop],
  )

  // Auto-start once per user. Wait for Clerk to resolve (so we don't flash the
  // tour before we know they've already seen it on another device), then start
  // only if neither the per-user flag nor the local flag is set — and only if an
  // anchor is actually on this page.
  useEffect(() => {
    // If Clerk is present but still loading, hold — the metadata check needs it.
    if (isSignedIn && !isLoaded) return

    const seenForUser = isSignedIn && user?.unsafeMetadata?.tourSeen === true
    let seenLocal = false
    try {
      seenLocal = localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      /* ignore */
    }
    if (!seenForUser && !seenLocal && document.querySelector('[data-tour]')) {
      setActive(true)
    }
  }, [isLoaded, isSignedIn, user])

  // Allow anything to (re)launch the tour on demand.
  useEffect(() => {
    const onStart = () => {
      setStep(0)
      setActive(true)
    }
    window.addEventListener('lt:start-tour', onStart)
    return () => window.removeEventListener('lt:start-tour', onStart)
  }, [])

  // When active, position on the current step and keep the spotlight glued to the
  // element as the layout shifts (resize/scroll).
  useEffect(() => {
    if (!active) return
    goTo(step)
    const reposition = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
    // step is intentionally in deps so re-positioning tracks the active step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step])

  const next = useCallback(() => goTo(step + 1), [goTo, step])
  const prev = useCallback(() => goTo(Math.max(0, step - 1)), [goTo, step])

  // Keyboard: Esc closes, →/Enter advances, ← goes back.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        stop()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, next, prev, stop])

  if (!active || !rect) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  // Cutout: a transparent box the size of the target + padding, with an enormous
  // spread shadow that darkens everything else. pointer-events pass through the
  // hole so the highlighted control stays clickable.
  const cutout: React.CSSProperties = {
    position: 'fixed',
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
    borderRadius: 12,
    boxShadow: '0 0 0 9999px rgba(15, 15, 20, 0.62)',
    pointerEvents: 'none',
    zIndex: 9998,
    transition: 'all 220ms cubic-bezier(0.16, 1, 0.3, 1)',
  }

  // Tooltip below the target, clamped so it never runs off the left/right edge.
  const tipWidth = 300
  const tipLeft = Math.min(
    Math.max(12, rect.left),
    (typeof window !== 'undefined' ? window.innerWidth : tipWidth + 24) - tipWidth - 12,
  )
  const tip: React.CSSProperties = {
    position: 'fixed',
    top: rect.top + rect.height + PADDING + 12,
    left: tipLeft,
    width: tipWidth,
    zIndex: 9999,
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Feature tour">
      <div style={cutout} aria-hidden />
      <div style={tip} className="glass rounded-2xl p-4 text-[#16151a] shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-black/40">
          {step + 1} of {STEPS.length}
        </p>
        <h3 className="mt-1 font-[family-name:var(--font-serif)] text-lg">{current.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-black/70">{current.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={stop} className="text-sm text-black/45 hover:text-black/70">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={prev} className="btn-ghost text-sm">
                Back
              </button>
            )}
            <button onClick={isLast ? stop : next} className="btn-signal px-4 text-sm">
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
