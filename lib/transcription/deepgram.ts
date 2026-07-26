import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'

// Deepgram closes the stream after ~10-12s of no audio; a text KeepAlive resets
// that timer so a muted (silent) session survives. Send well inside the window.
const KEEPALIVE_MS = 5000
// Bound on how long disconnect() waits for the trailing final after CloseStream,
// so Stop never hangs if the server goes quiet.
const FINAL_FLUSH_MS = 800

export class DeepgramProvider implements TranscriptionProvider {
  private ws: WebSocket | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}
  private statusCb: (s: { error: string }) => void = () => {}
  private keepAlive: ReturnType<typeof setInterval> | null = null
  // Set while disconnect() is flushing; onmessage calls it when a final arrives.
  private onFinalFlush: (() => void) | null = null

  async connect(config: TranscriptionConfig): Promise<void> {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepgram' }),
    })
    if (!res.ok) throw new Error('Deepgram token mint failed')
    const { token } = await res.json()

    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'en-US',
      smart_format: 'true',
      interim_results: 'true',
      punctuate: 'true',
      diarize: 'true',
      endpointing: '50',
      no_delay: 'true',
      encoding: 'linear16',
      sample_rate: String(config.sampleRate),
      channels: '1',
    })
    // Cap at 100 (Deepgram's limit; also stays within its ~500-token budget) so a
    // large list can't get silently truncated mid-way by the server.
    config.keyterms.slice(0, 100).forEach((t) => params.append('keyterm', t))

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
        if (!opened) return // connect-time close already rejected via onerror/timeout
        this.stopKeepAlive()
        this.onFinalFlush?.() // unblock a pending disconnect flush
        this.statusCb({ error: 'Transcription connection closed' })
      }
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data)
        const alt = data.channel?.alternatives?.[0]
        if (!alt) return
        const words = alt.words ?? []
        const speaker = words[0]?.speaker // Deepgram speaker is a 0-based int
        const evt: TranscriptEvent = {
          text: alt.transcript ?? '',
          isFinal: data.is_final === true,
          speaker: typeof speaker === 'number' ? speaker : null,
          startMs: Math.round((words[0]?.start ?? data.start ?? 0) * 1000),
          endMs: Math.round(
            (words[words.length - 1]?.end ?? (data.start ?? 0) + (data.duration ?? 0)) * 1000,
          ),
        }
        if (!evt.text) return
        if (evt.isFinal) this.onFinalFlush?.() // let disconnect() resolve on the trailing final
        ;(evt.isFinal ? this.finalCb : this.partialCb)(evt)
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
    this.stopKeepAlive()
    // Silence the drop signal — this is a graceful close, not a failure.
    this.statusCb = () => {}
    const ws = this.ws
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CloseStream' }))
      // Wait for the server to flush its trailing final so the last utterance is
      // finalized (interim-only lines are excluded from the saved transcript).
      await new Promise<void>((resolve) => {
        const done = () => {
          this.onFinalFlush = null
          clearTimeout(t)
          resolve()
        }
        const t = setTimeout(done, FINAL_FLUSH_MS)
        this.onFinalFlush = done
      })
    }
    ws?.close()
    this.ws = null
  }
}
