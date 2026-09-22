import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteSessionClient, type RemoteClientDependencies, type RemoteSignalMessage, type RemoteSignaling } from './client'
import type { RemoteLease, RemoteNative } from './native'
import { remotePeerChannel, remoteRequestsChannel, type RemoteSession } from './protocol'

const hostId = `h_${'a'.repeat(24)}`
const helperId = `c_${'b'.repeat(24)}`
const otherHelperId = `c_${'c'.repeat(24)}`
const roomId = 'd'.repeat(32)
const display = { id: '1', name: 'Main display', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true }
const lease: RemoteLease = { leaseId: 'native-lease-1', display, heartbeatMs: 1000, expiresAfterMs: 5000, maxFrameBytes: 524288 }

async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve() }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed })
  return { promise, resolve, reject }
}

class DataChannel {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  binaryType: BinaryType = 'arraybuffer'
  onopen: RTCDataChannel['onopen'] = null
  onclose: RTCDataChannel['onclose'] = null
  onerror: RTCDataChannel['onerror'] = null
  onmessage: RTCDataChannel['onmessage'] = null
  send = vi.fn<(data: string | ArrayBuffer) => void>()
  constructor(readonly label: string) {}
  asRTC() { return this as unknown as RTCDataChannel }
  open() { this.readyState = 'open'; this.onopen?.call(this.asRTC(), new Event('open')) }
  receive(value: unknown) { this.onmessage?.call(this.asRTC(), new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })) }
  close() { this.readyState = 'closed'; this.onclose?.call(this.asRTC(), new Event('close')) }
  sentJSON() { return this.send.mock.calls.filter(([data]) => typeof data === 'string').map(([data]) => JSON.parse(data as string)) }
}

class Peer {
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  onicecandidate: RTCPeerConnection['onicecandidate'] = null
  onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null
  ondatachannel: RTCPeerConnection['ondatachannel'] = null
  channels = new Map<string, DataChannel>()
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'offer-sdp' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }))
  addIceCandidate = vi.fn(async () => {})
  async setLocalDescription(value: RTCSessionDescriptionInit) { this.localDescription = value }
  async setRemoteDescription(value: RTCSessionDescriptionInit) { this.remoteDescription = value }
  createDataChannel(label: string) {
    const channel = new DataChannel(label)
    this.channels.set(label, channel)
    return channel.asRTC()
  }
  receiveChannel(label: string) {
    const channel = this.createDataChannel(label)
    this.ondatachannel?.call(this as unknown as RTCPeerConnection, { channel } as RTCDataChannelEvent)
    return this.channels.get(label)!
  }
  close = vi.fn(() => { this.connectionState = 'closed' })
}

const clients: RemoteSessionClient[] = []

function setup(role: 'host' | 'controller' = 'host') {
  const grant: RemoteSession = {
    roomId, role, clientId: role === 'host' ? hostId : helperId, hostClientId: hostId, credential: 'memory-only-credential', invite: 'memory-only-invite',
    expiresAt: Date.now() + 30 * 60_000, displayName: role === 'host' ? 'Host AAAAAA' : 'Helper BBBBBB', iceServers: [], relayConfigured: false,
  }
  const listeners = new Map<string, (message: RemoteSignalMessage) => void>()
  const transport: RemoteSignaling = {
    subscribe: vi.fn(async (channel, callback) => { listeners.set(channel, callback) }),
    publish: vi.fn(async () => {}), close: vi.fn(),
  }
  let nativeStopped: ((event: { leaseId: string; reason: string }) => void) | null = null
  const native: RemoteNative = {
    capabilities: vi.fn(async () => ({ supported: true, protocolVersion: 1, platform: 'test', stopShortcut: 'Ctrl+Alt+Shift+X' })),
    displays: vi.fn(async () => [display]),
    start: vi.fn(async () => lease), heartbeat: vi.fn(async () => {}), setControl: vi.fn(async () => {}),
    input: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    onStopped: vi.fn(async (callback) => { nativeStopped = callback; return vi.fn() }),
  }
  const peers: Peer[] = []
  let unavailable: (() => void) | null = null
  const deps: RemoteClientDependencies = {
    native, request: vi.fn(async () => grant), now: Date.now,
    signaling: vi.fn((_grant, callback) => { unavailable = callback; return transport }),
    peer: vi.fn(() => { const peer = new Peer(); peers.push(peer); return peer as unknown as RTCPeerConnection }),
  }
  const onFrame = vi.fn()
  const client = new RemoteSessionClient({ dependencies: deps, onFrame })
  clients.push(client)
  const signal = (id: string, data: unknown) => listeners.get(role === 'host' ? remoteRequestsChannel(roomId) : remotePeerChannel(roomId, helperId))?.({ clientId: id, data })
  async function ready() {
    if (role === 'host') {
      await client.createHost('1')
      signal(helperId, { type: 'join' })
      await client.approve(helperId)
    } else {
      await client.join('invite')
      signal(hostId, { type: 'offer', sdp: 'offer-sdp' })
      await flush()
      peers[0].receiveChannel('control')
      peers[0].receiveChannel('screen')
    }
    const control = peers[0].channels.get('control')!
    const screen = peers[0].channels.get('screen')!
    control.open()
    screen.open()
    await flush()
    return { control, screen }
  }
  return { client, grant, deps, native, peers, transport, signal, ready, onFrame, nativeStop: () => nativeStopped?.({ leaseId: lease.leaseId, reason: 'shortcut' }), unavailable: () => unavailable?.() }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')) })
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); vi.useRealTimers() })

describe('remote session authorization and lifecycle', () => {
  it('requires explicit host approval and both channels before capturing; starts view-only', async () => {
    const h = setup()
    await h.client.createHost('1')
    h.signal('arbitrary', { type: 'join', sender: helperId })
    h.signal(hostId, { type: 'join' })
    expect(h.client.snapshot.pending).toEqual([])
    h.signal(helperId, { type: 'join' })
    expect(h.client.snapshot.pending).toEqual([{ clientId: helperId, code: 'Helper BBBBBB' }])
    expect(h.native.start).not.toHaveBeenCalled()
    await h.client.approve(otherHelperId)
    expect(h.peers).toHaveLength(0)
    await h.client.approve(helperId)
    await h.client.approve(otherHelperId)
    expect(h.peers).toHaveLength(1)
    h.peers[0].channels.get('control')!.open()
    await flush()
    expect(h.native.start).not.toHaveBeenCalled()
    h.peers[0].channels.get('screen')!.open()
    await flush()
    expect(h.native.start).toHaveBeenCalledTimes(1)
    expect(h.client.snapshot.status).toBe('connected')
    expect(h.client.snapshot.controlEnabled).toBe(false)
    h.peers[0].channels.get('control')!.receive({ type: 'permission', epoch: 2, enabled: true, display })
    h.peers[0].channels.get('control')!.receive({ type: 'input', epoch: 2, event: { seq: 1, type: 'key', key: 'a', down: true } })
    expect(h.native.setControl).not.toHaveBeenCalled()
    expect(h.native.input).not.toHaveBeenCalled()
  })

  it('rejects wrong-peer negotiation even when a payload claims the approved identity', async () => {
    const h = setup()
    await h.ready()
    h.signal(otherHelperId, { type: 'answer', sdp: 'forged', sender: helperId })
    h.signal(otherHelperId, { type: 'end' })
    await flush()
    expect(h.peers[0].remoteDescription).toBeNull()
    expect(h.client.snapshot.status).toBe('connected')
    h.signal(helperId, { type: 'answer', sdp: 'authentic' })
    await flush()
    expect(h.peers[0].remoteDescription?.sdp).toBe('authentic')
  })

  it('removes canceled pending requests without letting another helper end the host session', async () => {
    const h = setup()
    await h.client.createHost('1')
    h.signal(helperId, { type: 'join' })
    h.signal(otherHelperId, { type: 'join' })
    h.signal(helperId, { type: 'end' })
    expect(h.client.snapshot.status).toBe('waiting')
    expect(h.client.snapshot.pending.map((peer) => peer.clientId)).toEqual([otherHelperId])
    await h.client.stop()
    expect(h.transport.publish).toHaveBeenCalledWith(remotePeerChannel(roomId, otherHelperId), { type: 'end' })
  })

  it('forwards only enabled, bounded, monotonically sequenced input to native', async () => {
    const h = setup()
    const { control } = await h.ready()
    await h.client.setControl(true)
    for (const event of [
      { seq: 1, type: 'move', x: 0.4, y: 0.8 },
      { seq: 1, type: 'key', key: 'a', down: true },
      { seq: 2, type: 'move', x: 1.1, y: 0 },
      { seq: 3, type: 'key', key: 'Enter', down: true },
      { seq: 2, type: 'key', key: 'Enter', down: false },
    ]) control.receive({ type: 'input', epoch: 2, event })
    await flush()
    expect(vi.mocked(h.native.input).mock.calls.map(([, input]) => input.seq)).toEqual([1, 3])
    await h.client.setControl(false)
    control.receive({ type: 'input', epoch: 2, event: { seq: 4, type: 'key', key: 'x', down: true } })
    await flush()
    expect(h.native.input).toHaveBeenCalledTimes(2)
    expect(h.native.setControl).toHaveBeenLastCalledWith(lease.leaseId, false)
  })

  it('keeps revocation authoritative when a previous grant is still in flight', async () => {
    const h = setup()
    const { control } = await h.ready()
    const enabling = deferred<void>()
    vi.mocked(h.native.setControl).mockImplementationOnce(() => enabling.promise)
    const enable = h.client.setControl(true)
    await flush()
    const disable = h.client.setControl(false)
    expect(h.client.snapshot.controlEnabled).toBe(false)
    control.receive({ type: 'input', epoch: 2, event: { seq: 1, type: 'key', key: 'x', down: true } })
    enabling.resolve()
    await Promise.all([enable, disable])
    expect(vi.mocked(h.native.setControl).mock.calls.map(([, enabled]) => enabled)).toEqual([true, false])
    expect(h.client.snapshot.controlEnabled).toBe(false)
    expect(h.native.input).not.toHaveBeenCalled()
  })

  it('rejects inputs from an earlier permission epoch after control is re-enabled', async () => {
    const h = setup()
    const { control } = await h.ready()
    await h.client.setControl(true)
    const oldEpoch = control.sentJSON().findLast((message) => message.type === 'permission').epoch
    await h.client.setControl(false)
    await h.client.setControl(true)
    const currentEpoch = control.sentJSON().findLast((message) => message.type === 'permission').epoch
    control.receive({ type: 'input', epoch: oldEpoch, event: { seq: 10, type: 'key', key: 'x', down: true } })
    control.receive({ type: 'input', epoch: currentEpoch, event: { seq: 11, type: 'key', key: 'Enter', down: true } })
    await flush()
    expect(vi.mocked(h.native.input).mock.calls.map(([, event]) => event.seq)).toEqual([11])
  })

  it('keeps screen sharing when revocation rejects an input already in flight', async () => {
    const h = setup()
    const { control } = await h.ready()
    await h.client.setControl(true)
    const pending = deferred<void>()
    vi.mocked(h.native.input).mockImplementationOnce(() => pending.promise)
    control.receive({ type: 'input', epoch: 2, event: { seq: 1, type: 'key', key: 'a', down: true } })
    await flush()
    expect(h.native.input).toHaveBeenCalledOnce()
    await h.client.setControl(false)
    pending.reject(new Error('Remote control has not been enabled.'))
    await flush()
    expect(h.client.snapshot.status).toBe('connected')
    expect(h.client.snapshot.controlEnabled).toBe(false)
    expect(h.native.stop).not.toHaveBeenCalled()
  })

  it('stops when native input fails under unchanged control permission', async () => {
    const h = setup()
    const { control } = await h.ready()
    await h.client.setControl(true)
    vi.mocked(h.native.input).mockRejectedValueOnce(new Error('The native input worker failed.'))
    control.receive({ type: 'input', epoch: 2, event: { seq: 1, type: 'key', key: 'a', down: true } })
    await flush()
    expect(h.client.snapshot.status).toBe('ended')
    expect(h.native.stop).toHaveBeenCalledWith(lease.leaseId)
  })

  it('extends the native lease only for fresh peer pings and stops after lost heartbeats', async () => {
    const h = setup()
    const { control } = await h.ready()
    control.receive({ type: 'ping', seq: 1 })
    await flush()
    control.receive({ type: 'ping', seq: 1 })
    control.receive({ type: 'permission', epoch: 2, enabled: true, display })
    expect(h.native.heartbeat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.client.snapshot.status).toBe('ended')
    expect(h.native.stop).toHaveBeenCalledWith(lease.leaseId)
    expect(h.client.snapshot.invite).toBeNull()
  })

  it('stops a capture lease that finishes starting after the user has disconnected', async () => {
    const h = setup()
    const starting = deferred<RemoteLease>()
    vi.mocked(h.native.start).mockImplementation(() => starting.promise)
    await h.ready()
    expect(h.client.snapshot.status).toBe('connecting')
    await h.client.stop()
    starting.resolve(lease)
    await flush()
    expect(h.native.stop).toHaveBeenCalledWith(lease.leaseId)
    expect(h.client.snapshot.status).toBe('ended')
  })

  it('ends immediately for native emergency stop and closes both transports', async () => {
    const h = setup()
    await h.ready()
    h.nativeStop()
    await flush()
    expect(h.client.snapshot.status).toBe('ended')
    expect(h.transport.close).toHaveBeenCalledOnce()
    expect(h.peers[0].close).toHaveBeenCalledOnce()
    expect(h.native.stop).toHaveBeenCalledOnce()
  })

  it('bounds pending input instead of retaining an unbounded stream behind native input', async () => {
    const h = setup()
    const { control } = await h.ready()
    await h.client.setControl(true)
    const pending = deferred<void>()
    vi.mocked(h.native.input).mockImplementation(() => pending.promise)
    for (let seq = 1; seq <= 40; seq++) control.receive({ type: 'input', epoch: 2, event: { seq, type: 'move', x: 0.5, y: 0.5 } })
    expect(h.client.snapshot.status).toBe('ended')
    expect(h.native.stop).toHaveBeenCalledWith(lease.leaseId)
    pending.resolve()
  })

  it('cleans up on offline and enforces the hard session expiry while waiting', async () => {
    const h = setup()
    await h.client.createHost('1')
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(h.client.snapshot.status).toBe('ended')
    expect(h.client.snapshot.endedReason).toContain('30-minute')
    const next = setup()
    await next.ready()
    window.dispatchEvent(new Event('offline'))
    await flush()
    expect(next.client.snapshot.status).toBe('ended')
    expect(next.native.stop).toHaveBeenCalledWith(lease.leaseId)
  })

  it('does not resurrect an aborted create request or accept expired grants', async () => {
    const h = setup()
    const pending = deferred<RemoteSession>()
    vi.mocked(h.deps.request).mockImplementation(() => pending.promise)
    const create = h.client.createHost('1')
    await flush()
    await h.client.stop()
    pending.resolve(h.grant)
    await create
    expect(h.deps.signaling).not.toHaveBeenCalled()
    expect(h.client.snapshot.status).toBe('ended')
    const expired = setup()
    expired.grant.expiresAt = Date.now() - 1
    await expired.client.createHost('1')
    expect(expired.client.snapshot.status).toBe('error')
    expect(expired.deps.signaling).not.toHaveBeenCalled()
  })
})

describe('browser controller', () => {
  it('pins the server-issued host identity and requires a host permission message', async () => {
    const h = setup('controller')
    await h.client.join('invite')
    h.signal(`h_${'f'.repeat(24)}`, { type: 'offer', sdp: 'forged', sender: hostId })
    await flush()
    expect(h.peers).toHaveLength(0)
    expect(h.client.sendInput({ type: 'text', text: 'hello' })).toBe(false)
  })

  it('releases held keys and mouse buttons on blur, and never sends malformed input', async () => {
    const h = setup('controller')
    const { control } = await h.ready()
    expect(h.client.sendInput({ type: 'key', key: 'Shift', down: true })).toBe(false)
    control.receive({ type: 'permission', epoch: 2, enabled: true, display })
    expect(h.client.sendInput({ type: 'move', x: -1, y: 0.4 })).toBe(false)
    expect(h.client.sendInput({ type: 'key', key: 'Shift', down: true })).toBe(true)
    expect(h.client.sendInput({ type: 'button', button: 'left', down: true })).toBe(true)
    window.dispatchEvent(new Event('blur'))
    const inputs = control.sentJSON().filter((message) => message.type === 'input').map((message) => message.event)
    expect(inputs).toEqual([
      { seq: 1, type: 'key', key: 'Shift', down: true }, { seq: 2, type: 'button', button: 'left', down: true },
      { seq: 3, type: 'key', key: 'Shift', down: false }, { seq: 4, type: 'button', button: 'left', down: false },
    ])
    expect(h.native.start).not.toHaveBeenCalled()
  })

  it('ends the session when congestion would leave a remote key held', async () => {
    const h = setup('controller')
    const { control } = await h.ready()
    control.receive({ type: 'permission', epoch: 2, enabled: true, display })
    h.client.sendInput({ type: 'key', key: 'Shift', down: true })
    control.bufferedAmount = 100_000
    h.client.releaseInputs()
    expect(h.client.snapshot.status).toBe('ended')
    expect(h.peers[0].close).toHaveBeenCalled()
  })

  it('does not keep a dead peer alive with replayed or unsolicited pong messages', async () => {
    const h = setup('controller')
    const { control } = await h.ready()
    control.receive({ type: 'pong', seq: 1 })
    await vi.advanceTimersByTimeAsync(3_000)
    control.receive({ type: 'pong', seq: 1 })
    control.receive({ type: 'pong', seq: 999 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(h.client.snapshot.status).toBe('ended')
  })
})
