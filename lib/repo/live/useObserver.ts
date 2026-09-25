'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseScreenObservation, type ScreenObservation } from '../screenEvidence'
import { KeyframeGate } from './keyframes'

type Phase = 'idle' | 'requesting' | 'watching' | 'paused' | 'error'
/** Observes only an explicitly selected surface. No browser automation or IDE access. */
export function useRepoObserver(onObservation: (observation: ScreenObservation) => void) {
  const [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState(''), [captures, setCaptures] = useState(0), [reading, setReading] = useState(false)
  const callback = useRef(onObservation); callback.current = onObservation
  const generation = useRef(0), stream = useRef<MediaStream | null>(null), video = useRef<HTMLVideoElement | null>(null), request = useRef<AbortController | null>(null), gate = useRef(new KeyframeGate()), count = useRef(0), paused = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const small = useRef<HTMLCanvasElement | null>(null)
  const stop = useCallback(() => {
    generation.current++; paused.current = true
    if (timer.current) clearInterval(timer.current); timer.current = null
    request.current?.abort(); request.current = null
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null
    if (video.current) { video.current.srcObject = null; video.current = null }
    gate.current.reset(); small.current = null
    setPhase('idle'); setReading(false)
  }, [])
  useEffect(() => () => { stop() }, [stop])
  const analyzeImage = useCallback(async (image: string, token: number) => {
    if (request.current || token !== generation.current) return false
    if (count.current >= 240) { paused.current = true; setPhase('paused'); setError('Session capture budget reached (240). Stop and start a new session to continue.'); return false }
    if (image.length > 6000000) throw new Error('Screenshot is too large; crop the selected surface or reduce its resolution.')
    const controller = new AbortController(); request.current = controller; setReading(true)
    const deadline = setTimeout(() => controller.abort(), 20000)
    count.current++; setCaptures(count.current)
    try {
      const response = await fetch('/api/copilot/repo-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal: controller.signal })
      const body = await response.json()
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Screenshot extraction failed')
      const observation = parseScreenObservation(body.observation)
      if (token !== generation.current || controller.signal.aborted) return false
      callback.current(observation); return true
    } catch (e) {
      if (token === generation.current) { paused.current = true; setPhase('paused'); setError(controller.signal.aborted ? 'Capture timed out. Resume explicitly to retry.' : e instanceof Error ? e.message : 'Screenshot extraction failed.') }
      return false
    } finally { clearTimeout(deadline); if (request.current === controller) { request.current = null; setReading(false) } }
  }, [])
  const start = useCallback(async () => {
    stop(); const token = generation.current; paused.current = false; count.current = 0; setCaptures(0); setError(''); setPhase('requesting')
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen selection is unavailable in this webview. Use the browser capture option or upload screenshots.')
      const selected = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false })
      if (token !== generation.current) { selected.getTracks().forEach(t => t.stop()); return }
      stream.current = selected
      const element = document.createElement('video'); element.muted = true; element.srcObject = selected; element.playsInline = true
      video.current = element
      await element.play()
      if (token !== generation.current) return
      selected.getVideoTracks()[0]?.addEventListener('ended', stop, { once: true })
      const thumb = document.createElement('canvas'); thumb.width = 128; thumb.height = 128; small.current = thumb
      setPhase('watching')
      timer.current = setInterval(() => {
        if (paused.current || request.current || token !== generation.current || !element.videoWidth) return
        const ctx = thumb.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(element, 0, 0, 128, 128)
        const pixels = ctx.getImageData(0, 0, 128, 128).data
        if (gate.current.observe(pixels, performance.now()) !== 'capture') return
        const scale = Math.min(1, 2400 / Math.max(element.videoWidth, element.videoHeight))
        const full = document.createElement('canvas'); full.width = Math.max(1, Math.round(element.videoWidth * scale)); full.height = Math.max(1, Math.round(element.videoHeight * scale))
        full.getContext('2d')?.drawImage(element, 0, 0, full.width, full.height)
        void analyzeImage(full.toDataURL('image/jpeg', .94), token).then(accepted => { if (accepted && token === generation.current) gate.current.accept(pixels, performance.now()) }).catch(e => { setError(String(e)); paused.current = true; setPhase('paused') })
      }, 200)
    } catch (e) {
      if (token !== generation.current) return
      stop(); setPhase('error'); setError(e instanceof Error ? e.message : 'Screen selection failed')
    }
  }, [stop, analyzeImage])
  const togglePause = useCallback(() => { paused.current = !paused.current; if (paused.current) request.current?.abort(); setPhase(paused.current ? 'paused' : video.current ? 'watching' : 'idle'); setError('') }, [])
  const upload = useCallback(async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4400000) { setError('Choose PNG, JPEG or WebP under 4.4 MB.'); return }
    if (request.current) { setError('Wait for the current screenshot to finish.'); return }
    const token = generation.current
    setError('')
    const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read screenshot')); reader.readAsDataURL(file) }).catch(e => { setError(String(e)); return '' })
    if (image && token === generation.current) await analyzeImage(image, token)
  }, [analyzeImage])
  return { phase, error, captures, reading, start, stop, togglePause, upload }
}
