import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'
import { deepgramResult } from './results'
import { boundedKeyterms } from './recognition'

// Deepgram closes the stream after ~10-12s of no audio; a text KeepAlive resets
// that timer so a muted (silent) session survives. Send well inside the window.
const KEEPALIVE_MS = 5000
// Bound on how long disconnect() waits for the trailing final after CloseStream,
// so Stop never hangs if the server goes quiet.
const FINAL_FLUSH_MS = 2000

export class DeepgramProvider implements TranscriptionProvider {
  private stream = ''
  private ws: WebSocket | null = null
  private removeAbort: (() => void) | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}
  private statusCb: (s: { error: string }) => void = () => {}
  private keepAlive: ReturnType<typeof setInterval> | null = null
  // Resolves only on terminal acknowledgement, close, abort or bounded timeout.
  private onFinalFlush: (() => void) | null = null

  async connect(config: TranscriptionConfig): Promise<void> {
    this.stream = crypto.randomUUID()
    config.signal?.throwIfAborted()
    const res = await fetch('/api/token', {
      method: 'POST',
      signal: config.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepgram' }),
    })
    if (!res.ok) throw new Error('Deepgram token mint failed')
    const { token } = await res.json()
    config.signal?.throwIfAborted()

    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'en-US',
      smart_format: 'true',
      interim_results: 'true',
      punctuate: 'true',
      diarize: 'true',
      endpointing: config.recognitionMode === 'careful' ? '500' : '300',
      encoding: 'linear16',
      sample_rate: String(config.sampleRate),
      channels: '1',
    })
    // Bound both count and prompt size, not just the number of terms.
    boundedKeyterms(config.keyterms).forEach((t) => params.append('keyterm', t))

    // Region-configurable WS host: point at the endpoint NEAREST your users to cut
    // RTT on both the handshake AND every interim result (Deepgram EU is GA:
    // wss://api.eu.deepgram.com/v1/listen — same token). Defaults to the global
    // (us) host, so behavior is unchanged unless NEXT_PUBLIC_DEEPGRAM_WS_URL is set.
    const base = process.env.NEXT_PUBLIC_DEEPGRAM_WS_URL || 'wss://api.deepgram.com/v1/listen'
    // A MINTED JWT uses the "bearer" subprotocol keyword (raw API keys would use "token").
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${base}?${params}`, ['bearer', token])
      this.ws = ws
      let opened = false
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Deepgram WS timeout'))
      }, 10_000)
      const abort = () => {
        clearTimeout(timeout)
        this.removeAbort?.()
        this.removeAbort = null
        this.stopKeepAlive()
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
        // Keep the stream alive across mutes/silence, regardless of audio flow.
        this.keepAlive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }))
        }, KEEPALIVE_MS)
        resolve()
      }
      // Before open: reject the connect promise. After open: surface the drop so
      // the UI stops the "recording" illusion (no double-invoke — opened gates it).
      ws.onerror = () => {
        if (!opened) {
          clearTimeout(timeout)
          reject(new Error('Deepgram WS error'))
          return
        }
        this.statusCb({ error: 'Transcription connection lost' })
      }
      ws.onclose = () => {
        clearTimeout(timeout)
        this.removeAbort?.()
        this.removeAbort = null
        if (!opened) { reject(new Error('Deepgram connection closed before opening')); return }
        this.stopKeepAlive()
        this.onFinalFlush?.() // unblock a pending disconnect flush
        this.statusCb({ error: 'Transcription connection closed' })
      }
      ws.onmessage = (msg) => {
        // Bad frames must not crash the recording page or mutate transcript state.
        let data
        try { data = JSON.parse(msg.data) } catch { return }
        if (!data || typeof data !== 'object') return
        if (data.type === 'Metadata') { this.onFinalFlush?.(); return }
        const evt = deepgramResult(data, this.stream)
        if (evt) (evt.isFinal ? this.finalCb : this.partialCb)(evt)
      }
    })
  }

  private stopKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive)
    this.keepAlive = null
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk)
  }
  async updateKeyterms(): Promise<void> {}
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
    this.stopKeepAlive()
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
        try { ws.send(JSON.stringify({ type: 'CloseStream' })) } catch { done() }
      })
    }
    if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.onopen = null; ws.close() }
    if (this.ws === ws) this.ws = null
  }
}
