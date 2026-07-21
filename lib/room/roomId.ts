// Friendly, shareable meeting IDs — "swift-otter-4821" — easy to read aloud or
// type, while still carrying enough entropy to resist enumeration:
// ADJ (32) × NOUN (32) × 10000 ≈ 10.2M combinations, and rooms are ephemeral.

const ADJECTIVES = [
  'swift', 'calm', 'bright', 'bold', 'warm', 'quiet', 'brave', 'clever',
  'gentle', 'lucky', 'mellow', 'nimble', 'plucky', 'royal', 'sunny', 'vivid',
  'amber', 'coral', 'jade', 'ivory', 'cosmic', 'lunar', 'polar', 'rapid',
  'silver', 'golden', 'crimson', 'azure', 'noble', 'keen', 'zesty', 'fresh',
]

const NOUNS = [
  'otter', 'falcon', 'maple', 'harbor', 'meadow', 'comet', 'willow', 'cedar',
  'river', 'summit', 'canyon', 'lantern', 'compass', 'beacon', 'ember', 'quartz',
  'pebble', 'ripple', 'thistle', 'juniper', 'sparrow', 'marble', 'walnut', 'cobalt',
  'orbit', 'meteor', 'delta', 'cove', 'cypress', 'basalt', 'zephyr', 'clover',
]

function pick<T>(arr: T[]): T {
  const b = crypto.getRandomValues(new Uint32Array(1))[0]
  return arr[b % arr.length]
}

export function newRoomId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${String(n).padStart(4, '0')}`
}

// word-word-#### — the shape newRoomId produces.
export function isFriendlyRoomId(id: string): boolean {
  return /^[a-z]{3,10}-[a-z]{3,10}-\d{4}$/.test(id)
}
