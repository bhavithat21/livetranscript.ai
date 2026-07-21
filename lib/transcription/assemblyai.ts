import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'

export class AssemblyAIProvider implements TranscriptionProvider {
  private ws: WebSocket | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}

  async connect(config: TranscriptionConfig): Promise<void> {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'assemblyai' }),
    })
    if (!res.ok) throw new Error('AssemblyAI token mint failed')
    const { token } = await res.json()

    // speech_model explicit; keyterms_prompt is JSON (URLSearchParams url-encodes it).
    // mode=balanced is the primary latency/accuracy preset (our two-track correction pass
    // covers accuracy, so we favor responsiveness here). max_speakers caps diarization at 5.
    const params = new URLSearchParams({
      speech_model: 'universal-3-5-pro',
      mode: 'balanced',
      sample_rate: String(config.sampleRate),
      speaker_labels: 'true',
      max_speakers: String(config.maxSpeakers),
      token,
    })
    if (config.keyterms.length) {
      params.set('keyterms_prompt', JSON.stringify(config.keyterms.slice(0, 100)))
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`)
      this.ws = ws
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('AssemblyAI WS timeout'))
      }, 10_000)
      ws.onopen = () => {
        clearTimeout(timeout)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('AssemblyAI WS error'))
      }
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data)
        if (data.type !== 'Turn') return
        // v3: turn-level speaker_label is a STRING ('A'/'B'/'UNKNOWN'); timing is per-word in ms.
        const words = Array.isArray(data.words) ? data.words : []
        const label: string | undefined = data.speaker_label ?? words[0]?.speaker
        const evt: TranscriptEvent = {
          text: data.transcript ?? '',
          isFinal: data.end_of_turn === true,
          speaker: label != null ? this.speakerIndex(label) : null,
          startMs: words[0]?.start ?? 0,
          endMs: words[words.length - 1]?.end ?? 0,
        }
        ;(evt.isFinal ? this.finalCb : this.partialCb)(evt)
      }
    })
  }

  // AssemblyAI returns string speaker labels ('A','B',...); map to stable 0-based indices for the palette.
  private labels = new Map<string, number>()
  private speakerIndex(label: string): number | null {
    if (label === 'UNKNOWN') return null
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
  async disconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'Terminate' }))
    this.ws?.close()
    this.ws = null
  }
}
