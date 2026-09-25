'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import styles from './StudioHome.module.css'

/** Progressive enhancement only. SSR/no-JS content remains visible. No wheel
 * interception, scroll hijacking, WebGL loop or audio on a transcription device.
 */
export function StudioMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const root = ref.current
    if (!root || !window.matchMedia || typeof IntersectionObserver === 'undefined') return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animations = new Set<Animation>()
    let observer: IntersectionObserver | undefined
    const stop = () => { observer?.disconnect(); animations.forEach(animation => animation.cancel()); animations.clear() }
    const start = () => {
      stop()
      if (paused || preference.matches) return
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          observer?.unobserve(entry.target)
          if (typeof entry.target.animate !== 'function') return
          const animation = entry.target.animate([
            { opacity: 0, transform: 'translateY(22px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], { duration: 620, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'none' })
          animations.add(animation)
          animation.onfinish = () => animations.delete(animation)
        })
      }, { threshold: .08 })
      root.querySelectorAll('[data-reveal]').forEach(element => observer?.observe(element))
    }
    start()
    preference.addEventListener('change', start)
    return () => { stop(); preference.removeEventListener('change', start) }
  }, [paused])
  return <div ref={ref} className={styles.motionRoot} data-motion-paused={paused || undefined}>
    <button type="button" className={styles.motionButton} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}{paused ? 'Motion paused' : 'Pause motion'}</button>
    {children}
  </div>
}
