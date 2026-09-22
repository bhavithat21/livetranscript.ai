import { describe, expect, it } from 'vitest'
import { parseRemoteInvitation } from './invite'

describe('invitation input', () => {
  it('accepts a pasted invitation without navigating to a supplied URL', () => {
    expect(parseRemoteInvitation('  signed.invitation-token  ')).toBe('signed.invitation-token')
    expect(parseRemoteInvitation('https://livetranscript.ai/remote#invite=signed.invitation-token')).toBe('signed.invitation-token')
  })
  it('rejects empty, oversized, nested and unrelated links', () => {
    for (const raw of ['', 'x'.repeat(8193), 'https://example.com/other#invite=abc', 'javascript:alert(1)', 'abc\ndef']) {
      expect(() => parseRemoteInvitation(raw)).toThrow()
    }
  })
})
