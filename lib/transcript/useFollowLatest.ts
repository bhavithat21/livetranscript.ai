'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Live position is a user preference, not a measurement AFTER content grows.
 * A large incoming batch must not be mistaken for the user reading history.
 * Only an explicit upward gesture pauses follow. No smooth-scroll queue on ASR ticks.
 */
export function useFollowLatest(updateKey: unknown, enabled = true) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const viewportNode = useRef<HTMLDivElement | null>(null)
  const viewportRef = useCallback((node: HTMLDivElement | null) => { viewportNode.current = node; setViewport(node) }, [])
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const moveToLatest = useCallback(() => {
    const node = viewportNode.current
    if (node && enabled) node.scrollTop = node.scrollHeight
  }, [enabled])
  const pause = useCallback(() => { followingRef.current = false; setFollowing(false) }, [])
  const resume = useCallback(() => {
    followingRef.current = true
    setFollowing(true)
    moveToLatest()
  }, [moveToLatest])

  useLayoutEffect(() => {
    if (enabled && followingRef.current) moveToLatest()
  }, [updateKey, enabled, content, moveToLatest])

  useEffect(() => {
    if (!viewport || !enabled) return
    let userGestureUntil = 0
    let previousTop = viewport.scrollTop
    let touchY: number | null = null
    const gesture = () => { userGestureUntil = Date.now() + 1000 }
    const wheel = (event: WheelEvent) => { gesture(); if (event.deltaY < 0) pause() }
    const touchStart = (event: TouchEvent) => { gesture(); touchY = event.touches[0]?.clientY ?? null }
    const touchMove = (event: TouchEvent) => {
      gesture()
      const y = event.touches[0]?.clientY ?? null
      if (y != null && touchY != null && y > touchY + 2) pause()
      touchY = y
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      gesture()
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause()
      if (event.key === 'End') resume()
    }
    const onScroll = () => {
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 32
      if (!followingRef.current && atBottom && Date.now() <= userGestureUntil) resume()
      else if (followingRef.current && !atBottom && viewport.scrollTop < previousTop && Date.now() <= userGestureUntil) pause()
      previousTop = viewport.scrollTop
    }
    viewport.addEventListener('wheel', wheel, { passive: true })
    viewport.addEventListener('pointerdown', gesture, { passive: true })
    viewport.addEventListener('touchstart', touchStart, { passive: true })
    viewport.addEventListener('touchmove', touchMove, { passive: true })
    viewport.addEventListener('keydown', keyDown)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (followingRef.current) moveToLatest()
    })
    resize?.observe(viewport)
    if (content) resize?.observe(content)
    // Font changes, wrapping and hidden→visible tabs alter height without new text.
    return () => {
      resize?.disconnect()
      viewport.removeEventListener('wheel', wheel)
      viewport.removeEventListener('pointerdown', gesture)
      viewport.removeEventListener('touchstart', touchStart)
      viewport.removeEventListener('touchmove', touchMove)
      viewport.removeEventListener('keydown', keyDown)
      viewport.removeEventListener('scroll', onScroll)
    }
  }, [viewport, content, enabled, moveToLatest, pause, resume])
  return { viewportRef, contentRef: setContent, following, resume, pause, viewport }
}
