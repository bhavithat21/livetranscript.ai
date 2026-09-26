import { abortable } from './clock'
import { TrackingMetrics, type VisualSeed } from './inline/tracking'
import type { SurfaceFrame } from './inline/geometry'
import { KeyframeGate, type FrameSignal } from './keyframes'
import { hashText, parseObservation } from './validation'
import type { Observation } from './types'

export type ScreenStatus = { sharing: boolean; watching: boolean; reading: boolean; captures: number; localSamples: number; error: string | null; source: 'browser' | 'native' | null; surface?: SurfaceFrame | null; acceptedSurfaceKey?: string | null; acceptedSurface?: SurfaceFrame | null; trackingError?: string | null; trackingNeedsReview?: boolean }
export type FrameSource = { signal: () => Promise<FrameSignal | null>; image: () => Promise<string | null>; stop: () => void | Promise<void>; surface?: () => SurfaceFrame | null; intervalMs?: () => number; track?: (seed: VisualSeed | null) => Promise<void> }
export type CaptureTransport = (image: string, signal: AbortSignal, locateRows?: boolean) => Promise<Observation>
export const httpCapture: CaptureTransport = async (image, signal, locateRows = false) => {
  const response = await fetch('/api/copilot/repo-screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, locateRows }), signal })
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
  private trackingId = ''
  private trackingGeneration = 0
  private refreshRequired = false
  private refreshEpoch = 0
  private rejectedReceipt = ''
  private grabbing = false
  private metrics = new TrackingMetrics()
  trackingReport = () => this.metrics.report()
  requestRefresh() { this.refreshEpoch++; this.refreshRequired = true; this.gate.reset() }
  async setTrackingSeed(seed: VisualSeed | null) {
    const id = seed ? `${seed.anchorId}:${seed.captureId}` : ''
    if (id === this.trackingId) return
    const generation = ++this.trackingGeneration
    this.trackingId = id; this.rejectedReceipt = ''
    this.update({ trackingError: null })
    try { await this.source?.track?.(seed) }
    catch { if (generation === this.trackingGeneration) this.update({ trackingError: 'Visual anchor unavailable. Fresh screenshot evidence is required.' }) }
  }
  constructor(private onObservation: (observation: Observation, capturedAt: number) => void, private transport: CaptureTransport = httpCapture) {}
  getSnapshot = () => this.status
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<ScreenStatus>) { this.status = { ...this.status, ...value }; this.listeners.forEach(listener => listener()) }
  async attach(source: FrameSource, type: 'browser' | 'native') {
    const stopping = this.stop(), expectedGeneration = this.generation
    await stopping
    if (expectedGeneration !== this.generation) { await source.stop(); return }
    this.source = source; this.gate.reset()
    this.update({ sharing: true, watching: false, source: type, error: null, surface: null, acceptedSurfaceKey: null, acceptedSurface: null })
  }
  watch(enabled: boolean) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!enabled) { this.generation++; this.controller?.abort(); this.controller = null; this.gate.reset(); this.update({ watching: false, reading: false, surface: null, acceptedSurfaceKey: null, acceptedSurface: null }); return }
    if (!this.source) return
    this.update({ watching: true, error: null, acceptedSurfaceKey: null })
    const generation = ++this.generation
    const tick = async () => {
      if (generation !== this.generation || !this.source || !this.status.watching) return
      try {
        const signal = await this.source.signal()
        if (generation !== this.generation) return
        this.update({ localSamples: this.status.localSamples + 1, surface: this.source.surface?.() ?? null })
        if (!signal) throw new Error('Selected screen is no longer available')
        const surface = this.source.surface?.() ?? null
        if (surface && typeof surface.captureMs === 'number') this.metrics.record(surface, surface.captureMs)
        const receipt = surface?.tracking
        if (receipt && (receipt.semanticDirty || ['edited','layout-changed','identity-changed'].includes(receipt.status))) {
          const rejection = `${receipt.anchorId}:${receipt.status}:${receipt.semanticDirty}`
          if (this.rejectedReceipt !== rejection) { this.rejectedReceipt = rejection; this.requestRefresh(); this.update({ trackingNeedsReview: true }) }
        }
        const reuse = !!receipt && this.trackingId.startsWith(`${receipt.anchorId}:`) && receipt.status === 'tracking' && !receipt.semanticDirty && !!surface?.focused && Date.now() - surface.sampledAt <= 450 && !this.refreshRequired
        // Scrolling a locally verified target does not reread/regenerate it.
        // New questions/explicit refresh, changed targets and background evidence
        // still use the bounded semantic path. No pixel stream is uploaded.
        if (reuse) this.metrics.reuse()
        const decision = reuse ? { capture: false } : this.gate.sample(signal, performance.now())
        if (decision.capture && !this.controller && !this.grabbing) {
          const capturedAt = Date.now(), image = await this.source.image()
          if (generation !== this.generation) return
          if (!image) throw new Error('Selected screen is no longer available')
          // Local samples continue while one extraction runs. No frame queue grows.
          void this.capture(image, capturedAt, this.source.surface?.() ?? null).then(accepted => {
            if (generation === this.generation) this.gate.finish(signal, accepted)
          })
        }
      } catch {
        if (generation === this.generation) { this.update({ watching: false, reading: false, error: 'Screen capture stopped. Check permissions or select the IDE again.' }); return }
      }
      if (generation === this.generation && this.status.watching) this.timer = setTimeout(() => void tick(), Math.max(40, Math.min(500, this.source?.intervalMs?.() ?? 250)))
    }
    void tick()
  }
  async capture(image: string, capturedAt = Date.now(), capturedSurface: SurfaceFrame | null = null): Promise<boolean> {
    if (this.controller) return false
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(image) || image.length > 6_000_000) { this.update({ error: 'Use a PNG, JPEG or WebP screenshot under 4.4 MB.', watching: false }); return false }
    const now = Date.now()
    this.requests = this.requests.filter(at => now - at < 60_000)
    if (this.totalRequests >= 180 || this.requests.length >= 20) { this.update({ error: 'Screenshot analysis budget reached. Watch paused; narrow the window and resume when ready.', watching: false }); return false }
    const controller = new AbortController(), generation = this.generation, refreshEpoch = this.refreshEpoch
    this.controller = controller; this.requests.push(now); this.totalRequests++
    this.update({ reading: true, error: null })
    const timeout = setTimeout(() => controller.abort(), 18_000)
    try {
      const observation = parseObservation(await abortable(this.transport(image, controller.signal, !!capturedSurface), controller.signal))
      if (controller.signal.aborted || generation !== this.generation) return false
      this.onObservation(observation, capturedAt)
      this.update({ captures: this.status.captures + 1, acceptedSurfaceKey: capturedSurface?.key ?? null, acceptedSurface: capturedSurface ? { ...capturedSurface, observationKey: hashText(JSON.stringify(observation)) } : null })
      if (refreshEpoch === this.refreshEpoch) { this.refreshRequired = false; this.update({ trackingNeedsReview: false }) }
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
    if (this.controller || this.grabbing) return false
    this.grabbing = true
    const generation = this.generation
    try {
      const capturedAt = Date.now(), image = await this.source?.image()
      if (generation !== this.generation) return false
      if (!image) { this.update({ error: 'Select the IDE or upload a screenshot first.' }); return false }
      return await this.capture(image, capturedAt, this.source?.surface?.() ?? null)
    } finally { this.grabbing = false }
  }

  async stop() {
    this.generation++; this.trackingGeneration++; this.trackingId = ''; this.refreshRequired = false; this.rejectedReceipt = ''
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.controller?.abort(); this.controller = null
    const source = this.source; this.source = null
    this.gate.reset(); this.update({ sharing: false, watching: false, reading: false, source: null, surface: null, acceptedSurfaceKey: null, acceptedSurface: null })
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
