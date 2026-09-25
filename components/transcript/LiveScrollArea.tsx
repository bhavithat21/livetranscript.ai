'use client'
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import { useFollowLatest } from '@/lib/transcript/useFollowLatest'
import { isTauri } from '@/lib/audio/useNativeCapture'
import { cn } from '@/lib/utils'

/** A single scroll owner. Archived documents remain ordinary pages. */
export function LiveScrollArea({ children, updateKey, enabled = true, className, style,
  label = 'Live transcript', flow = false, fade = false, nativeScroll = false,
}: { children: ReactNode; updateKey: unknown; enabled?: boolean; className?: string;
  style?: CSSProperties; label?: string; flow?: boolean; fade?: boolean; nativeScroll?: boolean }) {
  const { viewportRef, contentRef, following, resume, pause, viewport } = useFollowLatest(updateKey, enabled && !flow)
  useEffect(() => {
    if (!nativeScroll || !isTauri() || !viewport) return
    let live = true
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const off = await listen<string>('lock-scroll', event => {
        if (!live) return
        if (event.payload === 'up') pause()
        viewport.scrollBy({ top: viewport.clientHeight / 2 * (event.payload === 'up' ? -1 : 1), behavior: 'instant' })
        if (event.payload === 'down' && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 32) resume()
      })
      if (!live) off(); else unlisten = off
    }).catch(() => { /* Old native shells may not expose the optional scroll event. */ })
    return () => { live = false; unlisten?.() }
  }, [nativeScroll, viewport, pause, resume])
  return <div className={cn('live-scroll-area', className)} style={style} data-following={enabled && following} data-flow={flow || undefined}>
    <div ref={viewportRef} className={cn('live-scroll-viewport', fade && 'reading-fade')} tabIndex={flow ? undefined : 0} aria-label={label}>
      <div ref={contentRef} className="live-scroll-content">{children}</div>
    </div>
    {enabled && !flow && !following && <button type="button" className="live-scroll-resume" onClick={resume} aria-label={`Jump to latest ${label.toLowerCase()}`}><ArrowDown size={14} aria-hidden />Jump to latest</button>}
  </div>
}
