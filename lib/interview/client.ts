import type { InterviewRequest } from './session'

export async function requestInterview(request: InterviewRequest, signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/interview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal,
  })
  const data: unknown = await response.json().catch(() => null)
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in again, then retry. Your session has not been discarded.')
    throw new Error(typeof body.error === 'string' ? body.error : 'Interview service unavailable. Please retry.')
  }
  const result = body[request.action === 'question' ? 'question' : 'feedback']
  if (typeof result !== 'string' || !result.trim()) throw new Error('The interview service returned an empty response. Please retry.')
  return result
}

export function downloadInterview(title: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'interview'}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
