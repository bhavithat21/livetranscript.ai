import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'

export class DeepgramProvider implements TranscriptionProvider {
  private ws: WebSocket | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}

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

    // A MINTED JWT uses the "bearer" subprotocol keyword (raw API keys would use "token").
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['bearer', token])
      this.ws = ws
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Deepgram WS timeout'))
      }, 10_000)
      ws.onopen = () => {
        clearTimeout(timeout)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('Deepgram WS error'))
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
        ;(evt.isFinal ? this.finalCb : this.partialCb)(evt)
      }
    })
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
  async disconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'CloseStream' }))
    this.ws?.close()
    this.ws = null
  }
}
