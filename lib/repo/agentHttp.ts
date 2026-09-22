export class RepoRequestError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

// Check actual bytes as they arrive: Content-Length can be absent or dishonest.
export async function readRepoJson(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = req.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) throw new RepoRequestError('Request too large', 413)
  if (!req.body) throw new RepoRequestError('JSON object required')
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  let timedOut = false
  const cancel = () => { void reader.cancel().catch(() => {}) }
  req.signal.addEventListener('abort', cancel)
  const timeout = setTimeout(() => { timedOut = true; cancel() }, 10_000)
  try {
    for (;;) {
      if (req.signal.aborted) throw new RepoRequestError('Request cancelled', 499)
      const { done, value } = await reader.read()
      if (req.signal.aborted) throw new RepoRequestError('Request cancelled', 499)
      if (timedOut) throw new RepoRequestError('Request upload timed out', 408)
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new RepoRequestError('Request too large', 413)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    clearTimeout(timeout)
    req.signal.removeEventListener('abort', cancel)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new RepoRequestError('Invalid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepoRequestError('JSON object required')
  return value as Record<string, unknown>
}

export function boundedText(value: unknown, name: string, max: number, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new RepoRequestError(`${name} must be text`)
  if (value.length > max) throw new RepoRequestError(`${name} is too long`, 413)
  if (required && !value.trim()) throw new RepoRequestError(`${name} is required`)
  return value
}

export function parseRepoImage(value: unknown): { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string } {
  if (typeof value !== 'string' || value.length > 6_000_000) throw new RepoRequestError('Provide a screenshot smaller than 6 MB')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) throw new RepoRequestError('Provide a base64 PNG, JPEG, or WebP screenshot')
  const bytes = Buffer.from(match[2], 'base64')
  const signatureMatches = match[1] === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!signatureMatches) throw new RepoRequestError('Screenshot content does not match its image type')
  return { mediaType: match[1] as 'image/png' | 'image/jpeg' | 'image/webp', data: match[2] }
}
