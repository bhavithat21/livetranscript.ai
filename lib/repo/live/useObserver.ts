'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseScreenObservation, type ScreenObservation } from '../screenEvidence'
import { KeyframeGate } from './keyframes'
import { isNativeRepoHost, nativeDisplays, nativeDisplayFrame, startNativeDisplay, stopNativeDisplay, type NativeDisplay, type NativeLease } from './nativeCapture'

type Phase = 'idle' | 'requesting' | 'watching' | 'paused' | 'error'
/** Only explicitly selected browser surfaces or native displays are observed. */
export function useRepoObserver(onObservation: (observation: ScreenObservation) => void) {
  const [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState(''), [captures, setCaptures] = useState(0), [reading, setReading] = useState(false)
  const [nativeAvailable, setNativeAvailable] = useState(false), [displays, setDisplays] = useState<NativeDisplay[]>([]), [backend, setBackend] = useState<'browser' | 'native' | null>(null)
  const callback = useRef(onObservation)
  useEffect(() => { callback.current = onObservation }, [onObservation])
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) setNativeAvailable(isNativeRepoHost()) }); return () => { active = false } }, [])
  const generation = useRef(0), stream = useRef<MediaStream | null>(null), video = useRef<HTMLVideoElement | null>(null), request = useRef<AbortController | null>(null), gate = useRef(new KeyframeGate()), count = useRef(0), paused = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null), lease = useRef<NativeLease | null>(null), nativePolling = useRef(false), forceNative = useRef(false)
  const stop = useCallback(() => {
    generation.current++; paused.current = true
    if (timer.current) clearInterval(timer.current); timer.current = null
    request.current?.abort(); request.current = null
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null
    if (video.current) { video.current.srcObject = null; video.current = null }
    if (lease.current) { void stopNativeDisplay(lease.current.token).catch(() => {}); lease.current = null }
    gate.current.reset(); nativePolling.current = false
    setPhase('idle'); setReading(false); setBackend(null); setDisplays([])
  }, [])
  useEffect(() => () => { stop() }, [stop])
  const analyzeImage = useCallback(async (image: string, token: number): Promise<boolean> => {
    if (request.current || token !== generation.current) return false
    if (count.current >= 240) { paused.current = true; setPhase('paused'); setError('Capture budget reached (240). End this session before continuing.'); return false }
    if (image.length > 6000000) { setError('Screenshot is too large. Crop it to the editor.'); return false }
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
      if (token === generation.current) { paused.current = true; setPhase('paused'); setError(controller.signal.aborted ? 'Capture stopped or timed out. Resume explicitly to retry.' : e instanceof Error ? e.message : 'Screenshot extraction failed.') }
      return false
    } finally { clearTimeout(deadline); if (request.current === controller) { request.current = null; setReading(false) } }
  }, [])
  const start = useCallback(async () => {
    stop(); const token = generation.current; paused.current = false; count.current = 0; setCaptures(0); setError(''); setPhase('requesting')
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Browser screen selection is unavailable. Use Desktop display or upload screenshots.')
      const selected = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false })
      if (token !== generation.current) { selected.getTracks().forEach(t => t.stop()); return }
      stream.current = selected
      const element = document.createElement('video'); element.muted = true; element.srcObject = selected; element.playsInline = true
      video.current = element
      await element.play()
      if (token !== generation.current) return
      selected.getVideoTracks()[0]?.addEventListener('ended', stop, { once: true })
      const thumb = document.createElement('canvas'); thumb.width = 128; thumb.height = 128
      setBackend('browser'); setPhase('watching')
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
        void analyzeImage(full.toDataURL('image/jpeg', .94), token).then(accepted => { if (accepted && token === generation.current) gate.current.accept(pixels, performance.now()) })
      }, 200)
    } catch (e) { if (token === generation.current) { stop(); setPhase('error'); setError(e instanceof Error ? e.message : 'Screen selection failed') } }
  }, [stop, analyzeImage])
  const chooseNative = useCallback(async () => {
    stop(); setError(''); const token = generation.current
    try { const choices = await nativeDisplays(); if (token === generation.current) setDisplays(choices) }
    catch { if (token === generation.current) setError('Native screen observation is unavailable in this installer. Update the desktop app, or use browser sharing/screenshots.') }
  }, [stop])
  const beginNative = useCallback(async (id: string) => {
    stop(); const token = generation.current; paused.current = false; setError(''); setPhase('requesting'); count.current = 0; setCaptures(0)
    try {
      const opened = await startNativeDisplay(id)
      if (token !== generation.current) { await stopNativeDisplay(opened.token).catch(() => {}); return }
      lease.current = opened; setBackend('native'); setPhase('watching')
      timer.current = setInterval(() => {
        if (paused.current || request.current || nativePolling.current || token !== generation.current) return
        nativePolling.current = true
        const force = forceNative.current; forceNative.current = false
        void (async () => {
          try { const image = await nativeDisplayFrame(opened.token, force); if (image && token === generation.current && !paused.current) await analyzeImage(image, token) }
          catch (e) { if (token === generation.current) { paused.current = true; setPhase('paused'); setError(e instanceof Error ? e.message : 'Native capture stopped. Select the display again.') } }
          finally { if (token === generation.current) nativePolling.current = false }
        })()
      }, 200)
    } catch (e) { if (token === generation.current) { stop(); setPhase('error'); setError(e instanceof Error ? e.message : 'Native display selection failed') } }
  }, [stop, analyzeImage])
  const togglePause = useCallback(() => {
    // Wait for an aborted request to settle before resuming so its completion
    // cannot immediately pause a newer capture generation.
    if (paused.current && request.current) { setError('The previous capture is still stopping. Resume again in a moment.'); return }
    paused.current = !paused.current
    if (paused.current) request.current?.abort()
    else { gate.current.reset(); forceNative.current = true }
    setPhase(paused.current ? 'paused' : video.current || lease.current ? 'watching' : 'idle'); setError('')
  }, [])
  const captureNow = useCallback(() => { gate.current.reset(); forceNative.current = true }, [])
  const upload = useCallback(async (file: File): Promise<boolean> => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4400000) { setError('Choose PNG, JPEG or WebP under 4.4 MB.'); return false }
    if (request.current) { setError('Wait for the current screenshot.'); return false }
    const token = generation.current; setError('')
    const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read screenshot')); reader.readAsDataURL(file) }).catch(e => { setError(String(e)); return '' })
    return image && token === generation.current ? analyzeImage(image, token) : false
  }, [analyzeImage])
  return { phase, error, captures, reading, backend, start, stop, togglePause, captureNow, upload, nativeAvailable, displays, chooseNative, beginNative }
}
