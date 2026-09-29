import { KeyframeGate, type FrameSignal } from './keyframes'
import { hashText, parseObservation } from './validation'
import type { Observation } from './types'
import { diagnosticSpan, recordDiagnostic, diagnosticCode } from './diagnostics'

export type ScreenStatus = { sharing: boolean; watching: boolean; reading: boolean; captures: number; localSamples: number; error: string | null; source: 'browser' | 'native' | null; lastSampleAt: number | null; lastCaptureAt: number | null; gateReason: 'initial' | 'changed' | 'unchanged' | 'settling' | 'throttled' | 'busy' | null; changedTiles: number }
export type FrameSource = { signal: () => Promise<FrameSignal | null>; image: () => Promise<string | null>; stop: () => void | Promise<void>; preview?: MediaStream }
export type CaptureTransport = (image: string, signal: AbortSignal) => Promise<Observation>
export const httpCapture: CaptureTransport = async (image, signal) => {
  const trace = diagnosticSpan('screen_model')
  let status: number | undefined
  try {
    const response = await fetch('/api/copilot/repo-screen', { method: 'POST', headers: { 'Content-Type': 'application/json', ...trace.headers() }, body: JSON.stringify({ image }), signal })
    status = response.status
    if (!response.ok) {
      const message = response.status === 401 ? 'Sign in again to enable screen analysis.' : response.status === 429 ? 'Screen analysis limit reached. Try again later.' : response.status === 503 ? 'Screen analysis is unavailable. Check the vision provider configuration.' : `Screen analysis failed (${response.status}). Try again.`
      let detail = message
      try { const body = await response.json() as { error?: unknown }; if (typeof body.error === 'string' && body.error.length <= 500) detail = body.error } catch { /* proxy HTML */ }
      throw new Error(detail)
    }
    const raw = await response.text()
    if (raw.length > 400_000) throw new Error('Screenshot response exceeded its budget')
    const result = JSON.parse(raw)
    const observation = parseObservation(result.observation)
    trace.end('success', { httpStatus: status, model: result.model, count: observation.files.length })
    return observation
  } catch (error) { trace.failure(error, status); throw error }
}
export class ScreenObserver {
  private source: FrameSource | null = null
  private controller: AbortController | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private gate = new KeyframeGate()
  private heartbeatAt = 0
  private status: ScreenStatus = { sharing: false, watching: false, reading: false, captures: 0, localSamples: 0, error: null, source: null, lastSampleAt: null, lastCaptureAt: null, gateReason: null, changedTiles: 0 }
  private listeners = new Set<() => void>()
  private requests: number[] = []
  private totalRequests = 0
  constructor(private onObservation: (observation: Observation, capturedAt: number) => void, private transport: CaptureTransport = httpCapture) {}
  getSnapshot = () => this.status
  getPreviewStream = () => this.source?.preview ?? null
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<ScreenStatus>) {
    if (value.error && value.error !== this.status.error) recordDiagnostic('screen', 'error', { code: diagnosticCode(value.error), source: this.status.source })
    if (value.watching !== undefined && value.watching !== this.status.watching) recordDiagnostic('screen', value.watching ? 'start' : 'paused', { source: this.status.source })
    this.status = { ...this.status, ...value }; this.listeners.forEach(listener => listener())
  }
  async attach(source: FrameSource, type: 'browser' | 'native') {
    const stopping = this.stop(), expectedGeneration = this.generation
    await stopping
    if (expectedGeneration !== this.generation) { await source.stop(); return }
    this.source = source; this.gate.reset(); this.heartbeatAt = 0
    this.update({ sharing: true, watching: false, source: type, error: null, lastSampleAt: null, lastCaptureAt: null, gateReason: null, changedTiles: 0 })
    recordDiagnostic('screen', 'ready', { source: type })
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
        const first = this.status.lastSampleAt === null
        this.update({ localSamples: this.status.localSamples + 1, lastSampleAt: Date.now() })
        if (!signal) throw new Error('Selected screen is no longer available')
        if (first) recordDiagnostic('screen', 'first_frame', { source: this.status.source })
        const decision = this.gate.sample(signal, performance.now())
        this.update({ gateReason: decision.reason, changedTiles: decision.changedTiles })
        if (Date.now() - this.heartbeatAt >= 30_000) {
          this.heartbeatAt = Date.now()
          recordDiagnostic('screen', 'heartbeat', { source: this.status.source, frames: this.status.localSamples, count: this.status.captures, gate: decision.reason, captureAgeMs: this.status.lastCaptureAt === null ? undefined : Date.now() - this.status.lastCaptureAt })
        }
        if (decision.capture) {
          const capturedAt = Date.now(), image = await this.source.image()
          if (generation !== this.generation) return
          if (!image) throw new Error('Selected screen is no longer available')
          void this.capture(image, capturedAt).then(accepted => { if (generation === this.generation) this.gate.finish(signal, accepted) })
        }
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : 'Check screen-recording permission and select the display again.'
        if (generation === this.generation) { this.update({ watching: false, reading: false, error: `Screen capture stopped: ${reason}` }); return }
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
      this.update({ captures: this.status.captures + 1, lastCaptureAt: capturedAt })
      return true
    } catch (failure) {
      const reason = controller.signal.aborted ? 'Screen analysis timed out.' : failure instanceof Error ? failure.message : 'Screenshot could not be safely read.'
      if (generation === this.generation) this.update({ watching: false, error: `${reason} Screen analysis is paused. Retry analysis to keep the selected screen.` })
      return false
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) { this.controller = null; this.update({ reading: false }) }
    }
  }
  async captureNow() {
    const generation = this.generation, capturedAt = Date.now(), image = await this.source?.image()
    if (generation !== this.generation) return false
    if (!image) { this.update({ error: 'Select the IDE or upload a screenshot first.' }); return false }
    return this.capture(image, capturedAt)
  }
  async stop() {
    if (this.source) recordDiagnostic('screen', 'stop', { source: this.status.source, count: this.status.captures })
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.controller?.abort(); this.controller = null
    const source = this.source; this.source = null
    this.gate.reset(); this.update({ sharing: false, watching: false, reading: false, source: null, lastSampleAt: null, gateReason: null, changedTiles: 0 })
    await source?.stop()
  }
  dispose() { void this.stop(); this.listeners.clear() }
}
export async function browserFrameSource(onEnded: () => void): Promise<FrameSource> {
  const trace = diagnosticSpan('screen', { source: 'browser' })
  if (!navigator.mediaDevices?.getDisplayMedia) { trace.end('error', { code: 'unavailable' }); throw new Error('Browser screen sharing is unavailable; use the desktop app or upload a screenshot.') }
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false }); trace.end('success') }
  catch (error) { trace.failure(error); throw error }
  const video = document.createElement('video'); video.muted = true; video.srcObject = stream
  let stopped = false
  const stop = () => { if (!stopped) { stopped = true; stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null } }
  try { await video.play() } catch (error) { stop(); throw error }
  stream.getVideoTracks()[0]?.addEventListener('ended', onEnded, { once: true })
  const thumb = document.createElement('canvas'), full = document.createElement('canvas')
  const thumbnail = thumb.getContext('2d', { willReadFrequently: true }), context = full.getContext('2d')
  if (!thumbnail || !context) { stop(); throw new Error('Canvas capture unavailable') }
  return {
    preview: stream,
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
