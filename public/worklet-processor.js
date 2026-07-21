// Buffers ~50ms of audio before posting to the main thread. AssemblyAI requires
// 50–1000ms payloads; posting every ~128-sample quantum (~8ms) breaks it and floods threads.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // sampleRate is a global in AudioWorkletGlobalScope. ~50ms = 0.05 * rate samples.
    this._target = Math.round(sampleRate * 0.05)
    this._buf = new Float32Array(this._target)
    this._len = 0
  }
  process(inputs) {
    const ch = inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._len++] = ch[i]
      if (this._len === this._target) {
        let sumSq = 0
        for (let j = 0; j < this._len; j++) sumSq += this._buf[j] * this._buf[j]
        const out = this._buf.slice(0, this._len)
        this.port.postMessage({ samples: out, rms: Math.sqrt(sumSq / this._len) }, [out.buffer])
        this._buf = new Float32Array(this._target)
        this._len = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-processor', PCMProcessor)
