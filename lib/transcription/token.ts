export type TokenProvider = 'deepgram' | 'assemblyai'
export class TranscriptionTokenError extends Error {
  constructor(public status: number, public retryable: boolean) { super('Transcription credentials or service unavailable') }
}
/** Server-only. No raw credential, token, URL or response body goes into logs. */
export async function mintTranscriptionToken(provider: TokenProvider, parent?: AbortSignal) {
  const key = provider === 'deepgram' ? process.env.DEEPGRAM_API_KEY : process.env.ASSEMBLYAI_API_KEY
  if (!key) throw new TranscriptionTokenError(503, false)
  const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000)
  const response = provider === 'deepgram'
    ? await fetch('https://api.deepgram.com/v1/auth/grant', { method: 'POST', signal, headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 300 }) })
    : await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=300', { signal, headers: { Authorization: key } })
  if (!response.ok) throw new TranscriptionTokenError(response.status === 429 ? 429 : 502, [408, 429, 500, 502, 503, 504].includes(response.status))
  const value = await response.json()
  const token = provider === 'deepgram' ? value.access_token : value.token
  if (typeof token !== 'string' || !token || token.length > 16000) throw new TranscriptionTokenError(502, false)
  return { token, expiresAt: Date.now() + 300_000 }
}
