'use client'
import { useCallback, useRef, useState } from 'react'

// Screen capture for the copilot's vision (Phase 2). Opens getDisplayMedia video
// (the track useMicStream deliberately discards), holds it in an offscreen
// <video>, and grabs a DOWNSCALED JPEG frame on demand. Two cost/privacy levers:
//   - downscale to ~1024px long edge + JPEG q0.6 -> small payload, detail:low read
//   - MAD perceptual-diff vs the last grabbed frame -> identical screen returns
//     null (skips a redundant vision call)
// Privacy: explicit user gesture (the browser picker), a visible "sharing" state,
// and the stream is fully torn down on stop. Nothing is persisted.

const LONG_EDGE = 1024
const JPEG_QUALITY = 0.6
const DIFF_THUMB = 64 // luma thumbnail size for the perceptual diff
const DIFF_THRESHOLD = 0.02 // mean-abs-diff (0..1) below which the screen is "unchanged"

export function useScreenStream() {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastThumbRef = useRef<Uint8ClampedArray | null>(null)
  const lastFrameRef = useRef<string | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current = null
    }
    lastThumbRef.current = null
    lastFrameRef.current = null
    setSharing(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      streamRef.current = stream
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()
      videoRef.current = video
      // If the user stops sharing via the browser's own control, reflect it.
      stream.getVideoTracks()[0]?.addEventListener('ended', stop)
      setSharing(true)
    } catch (e) {
      // User cancelled the picker, or permission denied — not a hard error.
      setError(e instanceof Error && e.name === 'NotAllowedError' ? null : 'Could not start screen sharing')
      stop()
    }
  }, [stop])

  // Grab one downscaled JPEG. Returns null if unchanged since the last grab (MAD
  // gate) so the caller can skip a redundant vision call, or if not sharing.
  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null

    const scale = Math.min(1, LONG_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const w = Math.max(1, Math.round(video.videoWidth * scale))
    const h = Math.max(1, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)

    // Perceptual-diff gate: compare a tiny luma thumbnail to the previous grab.
    const thumb = document.createElement('canvas')
    thumb.width = DIFF_THUMB
    thumb.height = DIFF_THUMB
    const tctx = thumb.getContext('2d')
    if (tctx) {
      tctx.drawImage(video, 0, 0, DIFF_THUMB, DIFF_THUMB)
      const cur = tctx.getImageData(0, 0, DIFF_THUMB, DIFF_THUMB).data
      const prev = lastThumbRef.current
      if (prev) {
        let sum = 0
        // luma of every pixel; mean absolute difference normalized to 0..1
        for (let i = 0; i < cur.length; i += 4) {
          const lc = 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2]
          const lp = 0.299 * prev[i] + 0.587 * prev[i + 1] + 0.114 * prev[i + 2]
          sum += Math.abs(lc - lp)
        }
        const mad = sum / (cur.length / 4) / 255
        if (mad < DIFF_THRESHOLD && lastFrameRef.current) return null // unchanged -> skip
      }
      lastThumbRef.current = cur
    }

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    lastFrameRef.current = dataUrl
    return dataUrl
  }, [])

  return { sharing, error, start, stop, grabFrame }
}
