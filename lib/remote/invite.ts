/** Invites stay in component memory and the clipboard, never in storage. */
export function parseRemoteInvitation(raw: string): string {
  const value = raw.trim()
  if (!value || value.length > 8192) throw new Error('Paste the invitation copied from the laptop.')
  // Also accept a link pasted by a helper. Do not navigate to an arbitrary URL.
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.pathname !== '/remote') throw new Error('Invalid invitation link')
      const token = new URLSearchParams(url.hash.slice(1)).get('invite')
      if (!token) throw new Error('Missing invitation')
      return parseRemoteInvitation(token)
    } catch {
      throw new Error('This link has no remote invitation. Copy a fresh invitation from the laptop.')
    }
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('The invitation is incomplete. Copy it again from the laptop.')
  return value
}
