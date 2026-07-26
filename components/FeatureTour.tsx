'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

// A lightweight, dependency-free feature tour: dims the page, spotlights one
// element at a time (by its data-tour attribute), and shows a tooltip explaining
// it. Auto-runs once per user and can be relaunched any time by dispatching
// `window.dispatchEvent(new Event('lt:start-tour'))` (the nav "Tour" button does).
//
// Steps whose target isn't on the current page are skipped, so the same tour
// definition works across routes. No library: the cutout is one absolutely-
// positioned box with a huge box-shadow; the tooltip is one div.
//
// "Seen" is tracked per USER via Clerk unsafeMetadata when signed in (survives a
// new device/browser), with localStorage as the fallback + fast path. To keep
// useUser() out of a try/catch (which would violate the Rules of Hooks if the
// ClerkProvider's presence ever changed), the component splits on the build-time
// `clerkConfigured` flag: ClerkTour calls useUser unconditionally (provider is
// guaranteed present), the standalone branch never touches Clerk.

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

function hasSeenLocal(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeenLocal(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode — tour may re-run next visit, harmless */
  }
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

// An anchor that exists but is display:none (e.g. AppNav's md:flex link row on a
// phone) reports a zero-size rect and getBoundingClientRect() pins the spotlight
// to the top-left corner. Treat such anchors as absent so the tour skips them.
function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

// Entry point. Branches on the build-time Clerk flag so useUser() is only ever
// called where a ClerkProvider is guaranteed to be mounted — no try/catch, no
// conditional hook. clerkConfigured is constant per session, so the branch (and
// thus the hook tree) never changes across renders.
export function FeatureTour({ clerkConfigured }: { clerkConfigured: boolean }) {
  if (clerkConfigured) return <ClerkTour />
  return <TourView ready seenRemote={false} onSeen={markSeenLocal} />
}

// Signed-in aware: reads/writes the per-user "seen" flag from Clerk metadata.
function ClerkTour() {
  const { isLoaded, isSignedIn, user } = useUser()

  const onSeen = useCallback(() => {
    markSeenLocal()
    if (isSignedIn && user && user.unsafeMetadata?.tourSeen !== true) {
      // Fire-and-forget; a failed write just risks one extra tour next visit.
      user.update({ unsafeMetadata: { ...user.unsafeMetadata, tourSeen: true } }).catch(() => {})
    }
  }, [isSignedIn, user])

  const seenRemote = Boolean(isSignedIn) && user?.unsafeMetadata?.tourSeen === true
  // ready waits for Clerk to resolve so we don't flash the tour before we know
  // whether this user already saw it on another device.
  return <TourView ready={isLoaded} seenRemote={seenRemote} onSeen={onSeen} />
}

interface TourViewProps {
  ready: boolean // ok to evaluate auto-start (Clerk resolved, or standalone)
  seenRemote: boolean // per-user seen flag (always false without Clerk)
  onSeen: () => void // persist "seen" (localStorage + Clerk when available)
}

function TourView({ ready, seenRemote, onSeen }: TourViewProps) {
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  const stop = useCallback(() => {
    setActive(false)
    onSeen()
  }, [onSeen])

  // Resolve the target for a step, scanning in `dir` over steps whose element
  // isn't on the current page. Returns null if none remain in that direction.
  const resolve = useCallback((from: number, dir: 1 | -1): { index: number; el: Element } | null => {
    for (let i = from; i >= 0 && i < STEPS.length; i += dir) {
      const el = document.querySelector(`[data-tour="${STEPS[i].target}"]`)
      if (el && isVisible(el)) return { index: i, el }
    }
    return null
  }, [])

  const goTo = useCallback(
    (from: number, dir: 1 | -1) => {
      const found = resolve(from, dir)
      if (!found) {
        // Ran off the end going forward → tour is done. Off the start going back
        // → nothing earlier is on this page, so just stay put.
        if (dir === 1) stop()
        return
      }
      const r = found.el.getBoundingClientRect()
      setStep(found.index)
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    },
    [resolve, stop],
  )

  // Auto-start once per user. Hold until `ready`, then start only if neither the
  // per-user flag nor the local flag is set — and only if an anchor is on this page.
  useEffect(() => {
    if (!ready) return
    if (!seenRemote && !hasSeenLocal() && resolve(0, 1)) {
      setActive(true)
    }
  }, [ready, seenRemote, resolve])

  // Allow anything to (re)launch the tour on demand.
  useEffect(() => {
    const onStart = () => {
      setStep(0)
      setActive(true)
    }
    window.addEventListener('lt:start-tour', onStart)
    return () => window.removeEventListener('lt:start-tour', onStart)
  }, [])

  // Position on the current step and keep the spotlight glued to the element as
  // the layout shifts (resize/scroll). goTo is in deps so a fresh closure (e.g.
  // after sign-in changes `stop`) re-registers correctly. pathname is in deps so a
  // SPA navigation re-resolves: goTo(step, 1) advances to the next visible anchor,
  // or ends the tour when the new route has none (e.g. /record, where AppNav and
  // all its anchors unmount) — otherwise a stale spotlight and the capture-phase
  // key handler would linger over a page the tour can't point at.
  useEffect(() => {
    if (!active) return
    goTo(step, 1)
    const reposition = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`)
      if (!el || !isVisible(el)) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [active, step, goTo, pathname])

  const next = useCallback(() => goTo(step + 1, 1), [goTo, step])
  const prev = useCallback(() => goTo(step - 1, -1), [goTo, step])

  const visible = active && rect !== null

  // Focus management: move focus into the dialog when it appears, trap Tab within
  // it, and restore focus to the previously-focused element on close. Gated on
  // `visible` (not just `active`) because the dialog DOM only exists once rect is set.
  useEffect(() => {
    if (!visible) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()
    return () => previouslyFocused?.focus?.()
  }, [visible])

  // Keyboard: Esc closes, →/Enter advances, ← goes back, Tab is trapped inside.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        stop()
      } else if (e.key === 'Enter' && dialogRef.current?.contains(document.activeElement)) {
        // Focus is on one of the tour's own buttons (Skip/Back/Next) — let it
        // activate normally instead of forcing "advance". ArrowRight still advances.
        return
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'Tab') {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        )
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, next, prev, stop])

  if (!visible || !rect) return null

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
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Feature tour">
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
            <button ref={primaryRef} onClick={isLast ? stop : next} className="btn-signal px-4 text-sm">
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
