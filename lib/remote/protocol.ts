/** Shared wire limits. Every browser and native boundary must validate again. */
export const REMOTE_SESSION_MS = 30 * 60_000
export const REMOTE_TOKEN_MS = 5 * 60_000
export const REMOTE_INPUT_MAX_BYTES = 8_192
export const REMOTE_ID_PATTERN = /^[a-f0-9]{32}$/
export const REMOTE_CLIENT_PATTERN = /^[hc]_[a-f0-9]{24}$/

export type RemoteRole = 'host' | 'controller'

export type RemoteSession = {
  roomId: string
  role: RemoteRole
  clientId: string
  hostClientId: string
  credential: string
  invite?: string
  expiresAt: number
  displayName: string
  iceServers: RTCIceServer[]
  relayConfigured: boolean
}

export function remoteRequestsChannel(roomId: string): string {
  if (!REMOTE_ID_PATTERN.test(roomId)) throw new Error('Invalid remote room')
  return `remote:${roomId}:requests`
}

export function remotePeerChannel(roomId: string, clientId: string): string {
  if (!REMOTE_ID_PATTERN.test(roomId) || !/^c_[a-f0-9]{24}$/.test(clientId)) throw new Error('Invalid remote peer')
  return `remote:${roomId}:peer:${clientId}`
}

/** A server-issued Ably client ID is the identity; message.data is not. */
export function remoteDisplayName(clientId: string): string {
  if (!REMOTE_CLIENT_PATTERN.test(clientId)) throw new Error('Invalid remote client')
  return `${clientId.startsWith('h_') ? 'Host' : 'Helper'} ${clientId.slice(-6).toUpperCase()}`
}

export type RemoteInput =
  | { seq: number; type: 'move'; x: number; y: number }
  | { seq: number; type: 'button'; button: 'left' | 'middle' | 'right'; down: boolean }
  | { seq: number; type: 'key'; key: string; down: boolean }
  | { seq: number; type: 'scroll'; deltaX: number; deltaY: number }
  | { seq: number; type: 'text'; text: string }

const NAMED_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowRight',
  'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Insert',
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
])

function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function onlyFields(value: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(value).every(key => fields.includes(key))
}

export function isRemoteKey(value: unknown): value is string {
  return typeof value === 'string' && (NAMED_KEYS.has(value) || (
    Array.from(value).length === 1 && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)
  ))
}

/** Returns a new bounded object; never forwards caller-owned fields to native code. */
export function parseRemoteInput(value: unknown): RemoteInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  const seq = event.seq
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return null
  switch (event.type) {
    case 'move':
      return onlyFields(event, ['seq', 'type', 'x', 'y']) && finiteRange(event.x, 0, 1) && finiteRange(event.y, 0, 1)
        ? { seq, type: 'move', x: event.x, y: event.y } : null
    case 'button':
      return onlyFields(event, ['seq', 'type', 'button', 'down']) &&
        (event.button === 'left' || event.button === 'middle' || event.button === 'right') && typeof event.down === 'boolean'
        ? { seq, type: 'button', button: event.button, down: event.down } : null
    case 'key':
      return onlyFields(event, ['seq', 'type', 'key', 'down']) && isRemoteKey(event.key) && typeof event.down === 'boolean'
        ? { seq, type: 'key', key: event.key, down: event.down } : null
    case 'scroll':
      return onlyFields(event, ['seq', 'type', 'deltaX', 'deltaY']) &&
        Number.isInteger(event.deltaX) && Number.isInteger(event.deltaY) &&
        finiteRange(event.deltaX, -20, 20) && finiteRange(event.deltaY, -20, 20)
        ? { seq, type: 'scroll', deltaX: event.deltaX, deltaY: event.deltaY } : null
    case 'text':
      return onlyFields(event, ['seq', 'type', 'text']) && typeof event.text === 'string' &&
        event.text.length > 0 && event.text.length <= 1_000 && !event.text.includes('\0') &&
        new TextEncoder().encode(event.text).byteLength <= 4_000
        ? { seq, type: 'text', text: event.text } : null
    default: return null
  }
}

/** Scope to one approved connection; reset only when a fresh native lease starts. */
export function createRemoteInputGate() {
  let lastSequence = 0
  return (value: unknown): RemoteInput | null => {
    const input = parseRemoteInput(value)
    if (!input || input.seq <= lastSequence) return null
    lastSequence = input.seq
    return input
  }
}
