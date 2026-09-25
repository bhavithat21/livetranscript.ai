import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'
import { assemblyResult, type ResultMessage } from './results'
import { reviseSpeakers } from './speakerRevision'
import { boundedKeyterms } from './recognition'

// Bound on how long disconnect() waits for the trailing final after Terminate,
// so Stop never hangs if the server goes quiet.
const FINAL_FLUSH_MS = 2000

export class AssemblyAIProvider implements TranscriptionProvider {
  private stream = ''
  private finalTurns = new Map<number, ResultMessage>()
  private cachedCharacters = 0
  private ws: WebSocket | null = null
  private removeAbort: (() => void) | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}
  private statusCb: (s: { error: string }) => void = () => {}
  // Resolves only on terminal acknowledgement, close, abort or bounded timeout.
  private onFinalFlush: (() => void) | null = null

  async connect(config: TranscriptionConfig): Promise<void> {
    this.stream = crypto.randomUUID()
    this.labels.clear()
    this.finalTurns.clear(); this.cachedCharacters = 0
    config.signal?.throwIfAborted()
    const res = await fetch('/api/token', {
      method: 'POST',
      signal: config.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'assemblyai' }),
    })
    if (!res.ok) throw new Error('AssemblyAI token mint failed')
    const { token } = await res.json()
    config.signal?.throwIfAborted()

    // speech_model explicit; keyterms_prompt is JSON (URLSearchParams url-encodes it).
    // Native ASR formatting is retained; no LLM silently rewrites recognized speech.
    const params = new URLSearchParams({
      speech_model: 'universal-3-5-pro',
      mode: config.recognitionMode === 'careful' ? 'max_accuracy' : 'balanced',
      sample_rate: String(config.sampleRate),
      speaker_labels: 'true',
      max_speakers: String(config.maxSpeakers),
      token,
    })
    if (config.keyterms.length) {
      params.set('keyterms_prompt', JSON.stringify(boundedKeyterms(config.keyterms)))
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`)
      this.ws = ws
      let opened = false
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('AssemblyAI WS timeout'))
      }, 10_000)
      const abort = () => {
        clearTimeout(timeout)
        this.removeAbort?.()
        this.removeAbort = null
        this.onFinalFlush?.()
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        ws.close()
        if (this.ws === ws) this.ws = null
        reject(config.signal?.reason ?? new DOMException('Transcription cancelled', 'AbortError'))
      }
      config.signal?.addEventListener('abort', abort, { once: true })
      this.removeAbort = () => config.signal?.removeEventListener('abort', abort)
      if (config.signal?.aborted) { abort(); return }
      ws.onopen = () => {
        clearTimeout(timeout)
        opened = true
        resolve()
      }
      // Before open: reject the connect promise. After open: surface the drop so
      // the UI stops the "recording" illusion (no double-invoke — opened gates it).
      ws.onerror = () => {
        if (!opened) {
          clearTimeout(timeout)
          reject(new Error('AssemblyAI WS error'))
          return
        }
        this.statusCb({ error: 'Transcription connection lost' })
      }
      ws.onclose = () => {
        clearTimeout(timeout)
        this.removeAbort?.()
        this.removeAbort = null
        if (!opened) { reject(new Error('AssemblyAI connection closed before opening')); return }
        this.onFinalFlush?.() // unblock a pending disconnect flush
        this.statusCb({ error: 'Transcription connection closed' })
      }
      ws.onmessage = (msg) => {
        // Bad frames must not crash the recording page or mutate transcript state.
        let data
        try { data = JSON.parse(msg.data) } catch { return }
        if (!data || typeof data !== 'object') return
        if (data.type === 'Termination') { this.onFinalFlush?.(); return }
        if (data.type === 'SpeakerRevision' && Array.isArray(data.revisions)) {
          for (const revision of data.revisions.slice(0, 1000)) {
            if (!revision || typeof revision !== 'object') continue
            const old = this.finalTurns.get(revision.turn_order)
            const corrected = old && reviseSpeakers(old, revision)
            if (!corrected) continue
            this.finalTurns.set(revision.turn_order, corrected)
            const event = assemblyResult(corrected, this.stream, value => this.speakerIndex(value))
            if (event) this.finalCb(event)
          }
          return
        }
        const evt = assemblyResult(data, this.stream, value => this.speakerIndex(value))
        if (evt?.isFinal && Number.isInteger(data.turn_order) && data.turn_order >= 0) {
          const old = this.finalTurns.get(data.turn_order)
          this.cachedCharacters -= typeof old?.transcript === 'string' ? old.transcript.length : 0
          this.finalTurns.set(data.turn_order, data)
          this.cachedCharacters += evt.text.length
          while (this.finalTurns.size > 1000 || this.cachedCharacters > 250000) {
            const first = this.finalTurns.keys().next().value!
            const removed = this.finalTurns.get(first)
            this.cachedCharacters -= typeof removed?.transcript === 'string' ? removed.transcript.length : 0
            this.finalTurns.delete(first)
          }
        }
        if (evt) (evt.isFinal ? this.finalCb : this.partialCb)(evt)
      }
    })
  }

  // AssemblyAI returns string speaker labels ('A','B',...); map to stable 0-based indices for the palette.
  private labels = new Map<string, number>()
  private speakerIndex(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const label = String(value).trim()
    if (!label || /^(?:UNKNOWN|PENDING)$/i.test(label)) return null
    if (!this.labels.has(label)) this.labels.set(label, this.labels.size)
    return this.labels.get(label)!
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk)
  }
  async updateKeyterms(): Promise<void> {
    /* v1: keyterms fixed at connect */
  }
  onPartial(cb: (e: TranscriptEvent) => void) {
    this.partialCb = cb
  }
  onFinal(cb: (e: TranscriptEvent) => void) {
    this.finalCb = cb
  }
  onStatus(cb: (s: { error: string }) => void) {
    this.statusCb = cb
  }
  async disconnect(): Promise<void> {
    this.removeAbort?.()
    this.removeAbort = null
    // Silence the drop signal — this is a graceful close, not a failure.
    this.statusCb = () => {}
    const ws = this.ws
    if (ws?.readyState === WebSocket.OPEN) {
      // Register BEFORE sending. One final is not the end: providers may flush
      // several results before their terminal acknowledgement or socket close.
      await new Promise<void>((resolve) => {
        const done = () => { this.onFinalFlush = null; clearTimeout(timer); resolve() }
        const timer = setTimeout(done, FINAL_FLUSH_MS)
        this.onFinalFlush = done
        try { ws.send(JSON.stringify({ type: 'Terminate' })) } catch { done() }
      })
    }
    if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.onopen = null; ws.close() }
    if (this.ws === ws) this.ws = null
    this.finalTurns.clear(); this.cachedCharacters = 0
  }
}
