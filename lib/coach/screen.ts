import { KeyframeGate, type FrameSignal } from './keyframes'
import { hashText, parseObservation } from './validation'
import type { Observation } from './types'

export type ScreenStatus = { sharing: boolean; watching: boolean; reading: boolean; captures: number; localSamples: number; error: string | null; source: 'browser' | 'native' | null }
export type FrameSource = { signal: () => Promise<FrameSignal | null>; image: () => Promise<string | null>; stop: () => void | Promise<void> }
export type CaptureTransport = (image: string, signal: AbortSignal) => Promise<Observation>
export const httpCapture: CaptureTransport = async (image, signal) => {
  const response = await fetch('/api/copilot/repo-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal })
  if (!response.ok) throw new Error('Screenshot extraction failed')
  const raw = await response.text()
  if (raw.length > 400_000) throw new Error('Screenshot response exceeded its budget')
  return parseObservation(JSON.parse(raw).observation)
}
export class ScreenObserver {
  private source: FrameSource | null = null
  private controller: AbortController | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private gate = new KeyframeGate()
  private status: ScreenStatus = { sharing: false, watching: false, reading: false, captures: 0, localSamples: 0, error: null, source: null }
  private listeners = new Set<() => void>()
  private requests: number[] = []
  private totalRequests = 0
  constructor(private onObservation: (observation: Observation, capturedAt: number) => void, private transport: CaptureTransport = httpCapture) {}
  getSnapshot = () => this.status
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<ScreenStatus>) { this.status = { ...this.status, ...value }; this.listeners.forEach(listener => listener()) }
  async attach(source: FrameSource, type: 'browser' | 'native') {
    await this.stop()
    this.source = source; this.gate.reset()
    this.update({ sharing: true, watching: false, source: type, error: null })
  }
  watch(enabled: boolean) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!enabled) { this.generation++; this.controller?.abort(); this.controller = null; this.gate.reset(); this.update({ watching: false, reading: false }); return }
    if (!this.source) return
    this.update({ watching: true, error: null })
    const generation = ++this.generation
    const tick = async () => {
      if (generation !== this.generation || !this.source || !this.status.watching) return
      try {
        const signal = await this.source.signal()
        if (generation !== this.generation) return
        this.update({ localSamples: this.status.localSamples + 1 })
        if (!signal) throw new Error('Selected screen is no longer available')
        const decision = this.gate.sample(signal, performance.now())
        if (decision.capture) {
          const image = await this.source.image(), capturedAt = Date.now()
          if (generation !== this.generation) return
          if (!image) throw new Error('Selected screen is no longer available')
          // Local samples continue while one extraction runs. No frame queue grows.
          void this.capture(image, capturedAt).then(accepted => {
            if (generation === this.generation) this.gate.finish(signal, accepted)
          })
        }
      } catch {
        if (generation === this.generation) { this.update({ watching: false, reading: false, error: 'Screen capture stopped. Check permissions or select the IDE again.' }); return }
      }
      if (generation === this.generation && this.status.watching) this.timer = setTimeout(() => void tick(), 250)
    }
    void tick()
  }
  async capture(image: string, capturedAt = Date.now()): Promise<boolean> {
    if (this.controller) return false
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(image) || image.length > 6_000_000) { this.update({ error: 'Use a PNG, JPEG or WebP screenshot under 4.4 MB.', watching: false }); return false }
    const now = Date.now()
    this.requests = this.requests.filter(at => now - at < 60_000)
    if (this.totalRequests >= 180 || this.requests.length >= 20) { this.update({ error: 'Screenshot analysis budget reached. Watch paused; narrow the window and resume when ready.', watching: false }); return false }
    const controller = new AbortController(), generation = this.generation
    this.controller = controller; this.requests.push(now); this.totalRequests++
    this.update({ reading: true, error: null })
    const timeout = setTimeout(() => controller.abort(), 18_000)
    try {
      const observation = parseObservation(await this.transport(image, controller.signal))
      if (controller.signal.aborted || generation !== this.generation) return false
      this.onObservation(observation, capturedAt)
      this.update({ captures: this.status.captures + 1 })
      return true
    } catch {
      if (generation === this.generation) this.update({ watching: false, error: 'Screenshot could not be safely read. Watch is paused. Recapture explicitly; no automatic retry is made.' })
      return false
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) { this.controller = null; this.update({ reading: false }) }
    }
  }
  async captureNow() {
    const generation = this.generation, image = await this.source?.image()
    if (generation !== this.generation) return false
    if (!image) { this.update({ error: 'Select the IDE or upload a screenshot first.' }); return false }
    return this.capture(image)
  }
  async stop() {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.controller?.abort(); this.controller = null
    const source = this.source; this.source = null
    this.gate.reset(); this.update({ sharing: false, watching: false, reading: false, source: null })
    await source?.stop()
  }
  dispose() { void this.stop(); this.listeners.clear() }
}
export async function browserFrameSource(onEnded: () => void): Promise<FrameSource> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Browser screen sharing is unavailable; use the desktop app or upload a screenshot.')
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
  const video = document.createElement('video'); video.muted = true; video.srcObject = stream
  let stopped = false
  const stop = () => { if (!stopped) { stopped = true; stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null } }
  try { await video.play() } catch (error) { stop(); throw error }
  stream.getVideoTracks()[0]?.addEventListener('ended', onEnded, { once: true })
  const thumb = document.createElement('canvas'), full = document.createElement('canvas')
  const thumbnail = thumb.getContext('2d', { willReadFrequently: true }), context = full.getContext('2d')
  if (!thumbnail || !context) { stop(); throw new Error('Canvas capture unavailable') }
  return {
    async signal() {
      if (stopped || !video.videoWidth) return null
      const ratio = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
      thumb.width = Math.max(1, Math.round(video.videoWidth * ratio)); thumb.height = Math.max(1, Math.round(video.videoHeight * ratio))
      thumbnail.drawImage(video, 0, 0, thumb.width, thumb.height)
      const pixels = thumbnail.getImageData(0, 0, thumb.width, thumb.height).data, luma = new Uint8Array(thumb.width * thumb.height)
      for (let i = 0; i < luma.length; i++) luma[i] = Math.round((0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]) / 8) * 8
      let signature = ''
      for (let i = 0; i < luma.length; i += 8192) signature += String.fromCharCode(...luma.subarray(i, i + 8192))
      return { width: thumb.width, height: thumb.height, pixels: luma, fingerprint: hashText(signature) }
    },
    async image() {
      if (stopped || !video.videoWidth) return null
      const ratio = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight))
      full.width = Math.round(video.videoWidth * ratio); full.height = Math.round(video.videoHeight * ratio)
      context.drawImage(video, 0, 0, full.width, full.height)
      return full.toDataURL('image/jpeg', 0.94)
    }, stop,
  }
}
