import { InterviewInputError, MAX_BODY_BYTES } from './model'

/** Enforce an actual byte cap, including requests without Content-Length. */
export async function readInterviewBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > MAX_BODY_BYTES) throw new InterviewInputError('Request is too large.')
  if (!request.body) throw new InterviewInputError('A JSON request body is required.')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new InterviewInputError('Request is too large.')
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
  } finally { reader.releaseLock() }
  try { return JSON.parse(body) as unknown }
  catch { throw new InterviewInputError('Invalid JSON request.') }
}
