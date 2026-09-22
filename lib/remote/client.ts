'use client'

import * as Ably from 'ably'
import { FrameAssembler, sendFrame } from './frames'
import { remoteNative, type RemoteDisplay, type RemoteLease, type RemoteNative } from './native'
import {
  createRemoteInputGate, parseRemoteInput, REMOTE_CLIENT_PATTERN, REMOTE_ID_PATTERN, REMOTE_SESSION_MS,
  remoteDisplayName, remotePeerChannel, remoteRequestsChannel, type RemoteInput, type RemoteSession,
} from './protocol'

export type { RemoteDisplay } from './native'
export type RemoteInputDraft = RemoteInput extends infer T ? T extends RemoteInput ? Omit<T, 'seq'> : never : never
export type RemoteSnapshot = {
  status: 'idle' | 'creating' | 'waiting' | 'connecting' | 'connected' | 'ended' | 'error'
  role: 'host' | 'controller' | null
  invite: string | null
  helperCode: string | null
  pending: { clientId: string; code: string }[]
  controlEnabled: boolean
  error: string | null
  endedReason: string | null
  relayConfigured: boolean
  expiresAt: number | null
  display: RemoteDisplay | null
}

export const initialRemoteSnapshot: RemoteSnapshot = {
  status: 'idle', role: null, invite: null, helperCode: null, pending: [], controlEnabled: false,
  error: null, endedReason: null, relayConfigured: false, expiresAt: null, display: null,
}

export type RemoteSignalMessage = { clientId?: string; data: unknown }
export type RemoteSignaling = {
  subscribe(channel: string, callback: (message: RemoteSignalMessage) => void): Promise<void>
  publish(channel: string, data: unknown): Promise<void>
  close(): void
}

export type RemoteClientDependencies = {
  native: RemoteNative
  request(body: Record<string, string>, signal: AbortSignal): Promise<RemoteSession>
  signaling(session: RemoteSession, onUnavailable: () => void, signal: AbortSignal): RemoteSignaling
  peer(configuration: RTCConfiguration): RTCPeerConnection
  now(): number
}

type Signal =
  | { type: 'join' | 'deny' | 'end' }
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
type Control =
  | { type: 'ping' | 'pong'; seq: number }
  | { type: 'permission'; epoch: number; enabled: boolean; display: RemoteDisplay }
  | { type: 'input'; epoch: number; event: RemoteInput }
  | { type: 'end' }

const MAX_SIGNAL_BYTES = 65_536
const MAX_CONTROL_BYTES = 8_192
const MAX_BUFFERED_CONTROL = 32_768
const HEARTBEAT_MS = 1_000
const PEER_TIMEOUT_MS = 5_000
const CONNECT_TIMEOUT_MS = 30_000

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseSignal(value: unknown): Signal | null {
  if (!plain(value)) return null
  // Ably's payload is already parsed, but its message-size allowance is much
  // larger than ours. Check before copying SDP or ICE into the browser stack.
  let bytes: number
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).length } catch { return null }
  if (bytes > MAX_SIGNAL_BYTES) return null
  if (value.type === 'join' || value.type === 'deny' || value.type === 'end') return { type: value.type }
  if ((value.type === 'offer' || value.type === 'answer') && typeof value.sdp === 'string' && value.sdp.length > 0 && value.sdp.length <= 60_000) {
    return { type: value.type, sdp: value.sdp }
  }
  if (value.type === 'ice' && plain(value.candidate)) {
    const c = value.candidate
    if (typeof c.candidate !== 'string' || c.candidate.length > 4_096 ||
      !(c.sdpMid === null || c.sdpMid === undefined || (typeof c.sdpMid === 'string' && c.sdpMid.length <= 128)) ||
      !(c.sdpMLineIndex === null || c.sdpMLineIndex === undefined || (Number.isInteger(c.sdpMLineIndex) && (c.sdpMLineIndex as number) >= 0 && (c.sdpMLineIndex as number) <= 64))) return null
    return { type: 'ice', candidate: { candidate: c.candidate, sdpMid: c.sdpMid as string | null | undefined, sdpMLineIndex: c.sdpMLineIndex as number | null | undefined } }
  }
  return null
}

function parseDisplay(value: unknown): RemoteDisplay | null {
  if (!plain(value) || typeof value.id !== 'string' || value.id.length > 128 || typeof value.name !== 'string' || value.name.length > 256 || typeof value.isPrimary !== 'boolean') return null
  for (const key of ['x', 'y', 'width', 'height', 'scaleFactor']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return null
  if ((value.width as number) < 1 || (value.width as number) > 32_768 || (value.height as number) < 1 || (value.height as number) > 32_768 || (value.scaleFactor as number) <= 0 || (value.scaleFactor as number) > 8) return null
  return { id: value.id, name: value.name, x: value.x as number, y: value.y as number, width: value.width as number, height: value.height as number, scaleFactor: value.scaleFactor as number, isPrimary: value.isPrimary }
}

function parseControl(value: unknown): Control | null {
  if (typeof value !== 'string' || value.length > MAX_CONTROL_BYTES) return null
  let data: unknown
  try { data = JSON.parse(value) } catch { return null }
  if (!plain(data)) return null
  if ((data.type === 'ping' || data.type === 'pong') && Number.isSafeInteger(data.seq) && (data.seq as number) > 0) return { type: data.type, seq: data.seq as number }
  if (data.type === 'end') return { type: 'end' }
  if (data.type === 'input' && Number.isSafeInteger(data.epoch) && (data.epoch as number) > 0) {
    const event = parseRemoteInput(data.event)
    return event ? { type: 'input', epoch: data.epoch as number, event } : null
  }
  if (data.type === 'permission' && typeof data.enabled === 'boolean' && Number.isSafeInteger(data.epoch) && (data.epoch as number) > 0) {
    const display = parseDisplay(data.display)
    return display ? { type: 'permission', epoch: data.epoch as number, enabled: data.enabled, display } : null
  }
  return null
}

async function requestJSON<T>(body: Record<string, string>, signal: AbortSignal): Promise<T> {
  const timed = new AbortController()
  const cancel = () => timed.abort()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) timed.abort()
  const timeout = setTimeout(cancel, 12_000)
  try {
    const response = await fetch('/api/remote/session', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: timed.signal,
    })
    const reader = response.body?.getReader()
    let text = ''
    if (reader) {
      const decoder = new TextDecoder()
      let bytes = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > 65_536) { await reader.cancel(); throw new Error('Remote assistance returned an invalid response.') }
          text += decoder.decode(part.value, { stream: true })
        }
        text += decoder.decode()
      } finally { reader.releaseLock() }
    } else {
      text = await response.text()
      if (text.length > 65_536) throw new Error('Remote assistance returned an invalid response.')
    }
    let result: unknown
    try { result = JSON.parse(text) } catch { throw new Error(response.status === 401 || response.status === 404 ? 'Sign in to use remote assistance.' : 'Remote assistance is unavailable. Try again.') }
    if (!response.ok) throw new Error(plain(result) && typeof result.error === 'string' ? result.error.slice(0, 250) : 'Remote assistance is unavailable. Try again.')
    return result as T
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
  }
}

const dependencies: RemoteClientDependencies = {
  native: remoteNative,
  request: requestJSON<RemoteSession>,
  now: Date.now,
  peer: (configuration) => {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support remote assistance. Update it and try again.')
    return new RTCPeerConnection(configuration)
  },
  signaling(session, onUnavailable, signal) {
    const client = new Ably.Realtime({
      clientId: session.clientId,
      authCallback: (_params, callback) => {
        requestJSON<Ably.TokenDetails>({ action: 'token', credential: session.credential }, signal)
          .then((token) => callback(null, token), () => callback('Remote authentication expired. Start a new session.', null))
      },
    })
    for (const state of ['disconnected', 'suspended', 'failed', 'closed'] as const) client.connection.on(state, onUnavailable)
    return {
      async subscribe(channel, callback) {
        await client.channels.get(channel).subscribe('signal', (message) => callback({ clientId: message.clientId, data: message.data }))
      },
      async publish(channel, data) { await client.channels.get(channel).publish('signal', data) },
      close() {
        client.connection.off()
        Object.values(client.channels.all).forEach((channel) => channel.unsubscribe())
        client.close()
      },
    }
  },
}

/** One explicit, short-lived session. Credentials never leave this instance. */
export class RemoteSessionClient {
  private state: RemoteSnapshot = { ...initialRemoteSnapshot, pending: [] }
  private readonly deps: RemoteClientDependencies
  private readonly changed: (state: RemoteSnapshot) => void
  private readonly frame: (jpeg: Uint8Array) => void
  private generation = 0
  private disposed = false
  private abort: AbortController | null = null
  private session: RemoteSession | null = null
  private signaling: RemoteSignaling | null = null
  private pc: RTCPeerConnection | null = null
  private control: RTCDataChannel | null = null
  private screen: RTCDataChannel | null = null
  private lease: RemoteLease | null = null
  private unlisten: (() => void) | null = null
  private selectedDisplay = ''
  private approved: string | null = null
  private denied = new Set<string>()
  private captureStarting = false
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastPeerAt = 0
  private lastPing = 0
  private pingSequence = 0
  private lastPong = 0
  private frameSequence = 0
  private inputSequence = 0
  private permissionVersion = 0
  private remotePermissionVersion = 0
  private inputGate = createRemoteInputGate()
  private inputQueue: RemoteInput[] = []
  private inputBusyGeneration: number | null = null
  private heartbeatBusyGeneration: number | null = null
  private permissionQueue: Promise<void> = Promise.resolve()
  private iceQueue: RTCIceCandidateInit[] = []
  private signalingQueue: Promise<void> = Promise.resolve()
  private signalingPending = 0
  private readonly frames: FrameAssembler
  private heldKeys = new Set<string>()
  private heldButtons = new Set<'left' | 'middle' | 'right'>()
  private readonly leave = () => { void this.stop('The session ended because this page closed or went offline.') }
  private readonly blur = () => { this.releaseInputs() }

  constructor(options: { onChange?: (snapshot: RemoteSnapshot) => void; onFrame?: (jpeg: Uint8Array) => void; dependencies?: Partial<RemoteClientDependencies> } = {}) {
    this.changed = options.onChange ?? (() => {})
    this.frame = options.onFrame ?? (() => {})
    this.deps = { ...dependencies, ...options.dependencies }
    this.frames = new FrameAssembler(this.deps.now)
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.leave)
      window.addEventListener('offline', this.leave)
      window.addEventListener('blur', this.blur)
    }
  }

  get snapshot(): RemoteSnapshot { return this.state }

  private update(patch: Partial<RemoteSnapshot>): void {
    this.state = { ...this.state, ...patch }
    if (!this.disposed) this.changed(this.state)
  }

  private active(generation: number): boolean { return !this.disposed && generation === this.generation && !!this.abort && !this.abort.signal.aborted }

  private begin(role: 'host' | 'controller'): number {
    if (this.disposed) throw new Error('This remote session is closed.')
    if (!['idle', 'ended', 'error'].includes(this.state.status)) throw new Error('End the current session before starting another.')
    this.generation++
    this.abort = new AbortController()
    this.inputGate = createRemoteInputGate()
    this.permissionVersion++
    this.remotePermissionVersion = 0
    this.denied.clear()
    this.frames.reset()
    this.permissionQueue = this.signalingQueue = Promise.resolve()
    this.signalingPending = 0
    this.lastPing = this.lastPong = this.pingSequence = this.inputSequence = this.frameSequence = 0
    this.state = { ...initialRemoteSnapshot, pending: [] }
    this.update({ role, status: 'creating' })
    return this.generation
  }

  async createHost(displayId: string): Promise<void> {
    const generation = this.begin('host')
    this.selectedDisplay = displayId
    try {
      const capabilities = await this.deps.native.capabilities()
      if (!this.active(generation)) return
      if (!capabilities.supported || capabilities.protocolVersion !== 1) throw new Error('Open the updated desktop app on the laptop you want to share.')
      if (!displayId) throw new Error('Choose a display to share.')
      const session = await this.deps.request({ action: 'create' }, this.abort!.signal)
      if (!this.active(generation)) return
      await this.attach(session, 'host', generation)
    } catch (error) { if (this.active(generation)) await this.fail(error) }
  }

  async join(invite: string): Promise<void> {
    const generation = this.begin('controller')
    try {
      if (!invite || invite.length > 8_192) throw new Error('Paste a valid remote assistance invitation.')
      const session = await this.deps.request({ action: 'join', invite }, this.abort!.signal)
      if (!this.active(generation)) return
      await this.attach(session, 'controller', generation)
    } catch (error) { if (this.active(generation)) await this.fail(error) }
  }

  private async attach(session: RemoteSession, role: 'host' | 'controller', generation: number): Promise<void> {
    if (!session || session.role !== role || !REMOTE_ID_PATTERN.test(session.roomId) || !REMOTE_CLIENT_PATTERN.test(session.clientId) || !/^h_[a-f0-9]{24}$/.test(session.hostClientId) ||
      !(role === 'host' ? session.clientId === session.hostClientId : session.clientId.startsWith('c_')) || typeof session.credential !== 'string' ||
      !Number.isFinite(session.expiresAt) || session.expiresAt <= this.deps.now() || session.expiresAt > this.deps.now() + REMOTE_SESSION_MS + 10_000 || !Array.isArray(session.iceServers)) throw new Error('The remote session is invalid or expired. Start a new one.')
    this.session = session
    this.expiryTimer = setTimeout(() => { void this.stop('This session reached its 30-minute limit. Start a new session to continue.') }, session.expiresAt - this.deps.now())
    this.signaling = this.deps.signaling(session, () => { if (this.active(generation)) void this.stop('The remote signaling connection was lost.') }, this.abort!.signal)
    this.connectTimer = setTimeout(() => { if (this.active(generation)) void this.fail(new Error('The remote service did not connect. Check your connection and try again.')) }, 12_000)
    const channel = role === 'host' ? remoteRequestsChannel(session.roomId) : remotePeerChannel(session.roomId, session.clientId)
    await this.signaling.subscribe(channel, (message) => this.receiveSignal(message, generation))
    if (!this.active(generation)) return
    this.clearConnectTimer()
    this.update({ status: 'waiting', invite: role === 'host' ? session.invite ?? null : null, helperCode: role === 'controller' ? remoteDisplayName(session.clientId) : null, expiresAt: session.expiresAt, relayConfigured: session.relayConfigured })
    if (role === 'controller') await this.publish({ type: 'join' })
  }

  private receiveSignal(message: RemoteSignalMessage, generation: number): void {
    if (!this.active(generation) || !this.session) return
    const id = message.clientId
    if (!id || !REMOTE_CLIENT_PATTERN.test(id)) return
    if (this.session.role === 'controller' && id !== this.session.hostClientId) return
    if (this.session.role === 'host' && !id.startsWith('c_')) return
    const signal = parseSignal(message.data)
    if (!signal) return
    if (this.session.role === 'host' && signal.type === 'join') {
      if (this.approved || this.denied.has(id) || this.state.pending.some((peer) => peer.clientId === id) || this.state.pending.length >= 8) return
      this.update({ pending: [...this.state.pending, { clientId: id, code: remoteDisplayName(id) }] })
      return
    }
    if (this.session.role === 'host' && signal.type === 'end' && id !== this.approved) {
      this.update({ pending: this.state.pending.filter((peer) => peer.clientId !== id) })
      return
    }
    if (this.session.role === 'host' && id !== this.approved) return
    if (signal.type === 'deny' || signal.type === 'end') {
      void this.stop(signal.type === 'deny' ? 'The laptop owner declined this request.' : 'The other participant ended the session.')
      return
    }
    if (this.signalingPending >= 64) { void this.stop('The remote connection sent too many negotiation messages.'); return }
    this.signalingPending++
    this.signalingQueue = this.signalingQueue.then(async () => {
      if (!this.active(generation)) return
      if (signal.type === 'offer' && this.session?.role === 'controller' && !this.pc) {
        this.update({ status: 'connecting' })
        const pc = this.makePeer(generation)
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
        if (!this.active(generation)) return
        await this.flushIce(pc)
        const answer = await pc.createAnswer()
        if (!this.active(generation)) return
        await pc.setLocalDescription(answer)
        if (this.active(generation)) await this.publish({ type: 'answer', sdp: pc.localDescription?.sdp ?? answer.sdp ?? '' })
      } else if (signal.type === 'answer' && this.session?.role === 'host' && this.pc && !this.pc.remoteDescription) {
        const pc = this.pc
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
        if (this.active(generation)) await this.flushIce(pc)
      } else if (signal.type === 'ice') {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(signal.candidate)
        else if (this.iceQueue.length < 64) this.iceQueue.push(signal.candidate)
        else throw new Error('The remote connection sent too many network candidates.')
      }
    }).catch((error) => { if (this.active(generation)) void this.fail(error) }).finally(() => { this.signalingPending = Math.max(0, this.signalingPending - 1) })
  }

  async approve(clientId: string): Promise<void> {
    const generation = this.generation
    if (this.session?.role !== 'host' || this.approved || !this.state.pending.some((peer) => peer.clientId === clientId)) return
    this.approved = clientId
    const others = this.state.pending.filter((peer) => peer.clientId !== clientId)
    this.update({ pending: [], status: 'connecting', helperCode: remoteDisplayName(clientId) })
    for (const other of others) void this.publish({ type: 'deny' }, other.clientId).catch(() => {})
    try {
      const pc = this.makePeer(generation)
      this.setChannel(pc.createDataChannel('control', { ordered: true }), generation)
      this.setChannel(pc.createDataChannel('screen', { ordered: true, maxRetransmits: 0 }), generation)
      const offer = await pc.createOffer()
      if (!this.active(generation)) return
      await pc.setLocalDescription(offer)
      if (this.active(generation)) await this.publish({ type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp ?? '' })
    } catch (error) { if (this.active(generation)) await this.fail(error) }
  }

  async deny(clientId: string): Promise<void> {
    if (this.session?.role !== 'host' || !this.state.pending.some((peer) => peer.clientId === clientId)) return
    this.denied.add(clientId)
    this.update({ pending: this.state.pending.filter((peer) => peer.clientId !== clientId) })
    try { await this.publish({ type: 'deny' }, clientId) } catch { /* A denied helper never receives capture or a control channel. */ }
  }

  private async publish(signal: Signal, clientId = this.approved): Promise<void> {
    if (!this.session || !this.signaling) return
    const channel = this.session.role === 'controller' ? remoteRequestsChannel(this.session.roomId) : clientId ? remotePeerChannel(this.session.roomId, clientId) : null
    if (channel) await this.signaling.publish(channel, signal)
  }

  private makePeer(generation: number): RTCPeerConnection {
    const pc = this.deps.peer({ iceServers: this.session!.iceServers })
    this.pc = pc
    this.clearConnectTimer()
    this.connectTimer = setTimeout(() => { if (this.active(generation)) void this.fail(new Error(this.state.relayConfigured ? 'The laptop could not connect. Check both networks and try again.' : 'The laptops could not connect directly. A TURN relay is required on some networks.')) }, CONNECT_TIMEOUT_MS)
    pc.onicecandidate = (event) => {
      if (event.candidate && this.active(generation)) void this.publish({ type: 'ice', candidate: event.candidate.toJSON() }).catch(() => { if (this.active(generation)) void this.stop('The remote connection was lost.') })
    }
    pc.onconnectionstatechange = () => {
      if (this.active(generation) && ['disconnected', 'failed', 'closed'].includes(pc.connectionState)) void this.stop('The remote connection was lost.')
    }
    pc.ondatachannel = (event) => { if (this.active(generation)) this.setChannel(event.channel, generation) }
    return pc
  }

  private async flushIce(pc: RTCPeerConnection): Promise<void> {
    const candidates = this.iceQueue.splice(0)
    for (const candidate of candidates) await pc.addIceCandidate(candidate)
  }

  private setChannel(channel: RTCDataChannel, generation: number): void {
    if ((channel.label !== 'control' && channel.label !== 'screen') || (channel.label === 'control' ? this.control : this.screen)) { channel.close(); return }
    channel.binaryType = 'arraybuffer'
    if (channel.label === 'control') this.control = channel
    else this.screen = channel
    channel.onopen = () => { if (this.active(generation)) void this.channelsReady(generation) }
    channel.onclose = channel.onerror = () => { if (this.active(generation)) void this.stop('The remote connection was lost.') }
    channel.onmessage = (event) => {
      if (!this.active(generation)) return
      if (channel.label === 'control') this.receiveControl(event.data, generation)
      else if (this.session?.role === 'controller') {
        const frame = this.frames.push(event.data)
        if (frame) this.frame(frame)
      }
    }
    if (channel.readyState === 'open') void this.channelsReady(generation)
  }

  private async channelsReady(generation: number): Promise<void> {
    if (this.control?.readyState !== 'open' || this.screen?.readyState !== 'open' || this.captureStarting || this.heartbeatTimer) return
    this.clearConnectTimer()
    this.lastPeerAt = this.deps.now()
    this.heartbeatTimer = setInterval(() => this.tick(generation), HEARTBEAT_MS)
    if (this.session?.role === 'controller') {
      this.update({ status: 'connected' })
      this.tick(generation)
      return
    }
    this.captureStarting = true
    try {
      const unlisten = await this.deps.native.onStopped((event) => {
        if (this.active(generation) && this.lease?.leaseId === event.leaseId) void this.stop('Remote assistance stopped on the laptop.')
      })
      if (!this.active(generation)) { unlisten(); return }
      this.unlisten = unlisten
      const lease = await this.deps.native.start(this.selectedDisplay, (frame) => {
        if (this.active(generation) && this.screen) sendFrame(this.screen, frame, ++this.frameSequence)
      })
      if (!this.active(generation)) { await this.deps.native.stop(lease.leaseId).catch(() => {}); return }
      this.lease = lease
      this.update({ status: 'connected', display: lease.display, controlEnabled: false })
      this.sendControl({ type: 'permission', epoch: this.permissionVersion, enabled: false, display: lease.display })
    } catch (error) { if (this.active(generation)) await this.fail(error) }
    finally { if (this.active(generation)) this.captureStarting = false }
  }

  private tick(generation: number): void {
    if (!this.active(generation)) return
    if (this.deps.now() - this.lastPeerAt >= PEER_TIMEOUT_MS) { void this.stop('The other device stopped responding. Remote access has ended.'); return }
    if (this.session?.role === 'controller' && !this.sendControl({ type: 'ping', seq: ++this.pingSequence })) void this.stop('The remote connection is congested. Remote access has ended.')
  }

  private receiveControl(value: unknown, generation: number): void {
    const data = parseControl(value)
    if (!data) return
    if (data.type === 'end') { void this.stop('The other participant ended the session.'); return }
    if (this.session?.role === 'host') {
      if (data.type === 'ping' && data.seq > this.lastPing) {
        this.lastPing = data.seq
        this.lastPeerAt = this.deps.now()
        this.sendControl({ type: 'pong', seq: data.seq })
        if (this.lease && this.heartbeatBusyGeneration !== generation) {
          this.heartbeatBusyGeneration = generation
          void this.deps.native.heartbeat(this.lease.leaseId)
            .catch(() => { if (this.active(generation)) void this.stop('The desktop stopped remote assistance.') })
            .finally(() => { if (this.heartbeatBusyGeneration === generation) this.heartbeatBusyGeneration = null })
        }
      } else if (data.type === 'input' && data.epoch === this.permissionVersion && this.state.controlEnabled && this.lease) {
        const input = this.inputGate(data.event)
        if (!input) return
        if (this.inputQueue.length >= 32) { void this.stop('Too many remote inputs were queued. Remote access has ended.'); return }
        this.inputQueue.push(input)
        void this.drainInputs(generation)
      }
      // A controller cannot grant itself control by sending a permission message.
    } else if (this.session?.role === 'controller') {
      if (data.type === 'pong' && data.seq > this.lastPong && data.seq <= this.pingSequence) {
        this.lastPong = data.seq
        this.lastPeerAt = this.deps.now()
      } else if (data.type === 'permission' && data.epoch > this.remotePermissionVersion) {
        this.remotePermissionVersion = data.epoch
        if (!data.enabled) { this.heldKeys.clear(); this.heldButtons.clear() }
        this.update({ controlEnabled: data.enabled, display: data.display })
      }
    }
  }

  private async drainInputs(generation: number): Promise<void> {
    if (this.inputBusyGeneration === generation) return
    this.inputBusyGeneration = generation
    try {
      while (this.active(generation) && this.state.controlEnabled && this.lease && this.inputQueue.length) {
        const input = this.inputQueue.shift()!
        const permission = this.permissionVersion
        try {
          await this.deps.native.input(this.lease.leaseId, input)
        } catch {
          // Revocation deliberately invalidates work already queued in native.
          // That expected rejection must leave the view-only session available.
          if (this.active(generation) && this.state.controlEnabled && permission === this.permissionVersion) {
            await this.stop('The desktop stopped accepting remote input.')
            return
          }
        }
      }
    }
    finally { if (this.inputBusyGeneration === generation) this.inputBusyGeneration = null }
  }

  async setControl(enabled: boolean): Promise<void> {
    if (this.session?.role !== 'host' || !this.lease || this.state.status !== 'connected') return
    const generation = this.generation
    const version = ++this.permissionVersion
    const lease = this.lease
    if (!enabled) {
      this.inputQueue = []
      this.update({ controlEnabled: false })
      this.sendControl({ type: 'permission', epoch: version, enabled: false, display: lease.display })
    }
    const task = this.permissionQueue.then(async () => {
      if (!this.active(generation) || (enabled && version !== this.permissionVersion)) return
      await this.deps.native.setControl(lease.leaseId, enabled)
      if (this.active(generation) && version === this.permissionVersion) {
        this.update({ controlEnabled: enabled })
        if (!this.sendControl({ type: 'permission', epoch: version, enabled, display: lease.display })) await this.stop('The helper could not receive the permission change. Remote access has ended.')
      }
    })
    this.permissionQueue = task.catch(() => {})
    try { await task } catch (error) { if (this.active(generation)) await this.fail(error) }
  }

  private sendControl(data: Control): boolean {
    if (this.control?.readyState !== 'open' || this.control.bufferedAmount > MAX_BUFFERED_CONTROL) return false
    try { this.control.send(JSON.stringify(data)); return true } catch { return false }
  }

  sendInput(event: RemoteInputDraft): boolean {
    if (this.session?.role !== 'controller' || !this.state.controlEnabled || this.state.status !== 'connected') return false
    const input = parseRemoteInput({ ...event, seq: this.inputSequence + 1 })
    if (!input || !this.sendControl({ type: 'input', epoch: this.remotePermissionVersion, event: input })) return false
    this.inputSequence++
    if (input.type === 'key') { if (input.down) this.heldKeys.add(input.key); else this.heldKeys.delete(input.key) }
    if (input.type === 'button') { if (input.down) this.heldButtons.add(input.button); else this.heldButtons.delete(input.button) }
    return true
  }

  releaseInputs(): void {
    for (const key of [...this.heldKeys]) if (!this.sendInput({ type: 'key', key, down: false })) { void this.stop('Remote input focus was lost. Remote access has ended.'); break }
    for (const button of [...this.heldButtons]) if (!this.sendInput({ type: 'button', button, down: false })) { void this.stop('Remote input focus was lost. Remote access has ended.'); break }
    this.heldKeys.clear()
    this.heldButtons.clear()
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
  }

  private async fail(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Remote assistance could not start.'
    await this.end(message.slice(0, 300), true)
  }

  stop(reason = 'Remote assistance ended.'): Promise<void> { return this.end(reason, false) }

  private async end(reason: string, failed: boolean): Promise<void> {
    if (!this.abort && !this.session && !this.lease) return
    this.sendControl({ type: 'end' })
    // Best-effort signaling is bounded by immediate transport close. Native stop
    // is independent and the native lease also expires without controller pings.
    void this.publish({ type: 'end' }).catch(() => {})
    if (this.session?.role === 'host') {
      for (const pending of this.state.pending) void this.publish({ type: 'end' }, pending.clientId).catch(() => {})
    }
    this.generation++
    this.permissionVersion++
    this.abort?.abort()
    this.abort = null
    this.clearConnectTimer()
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.expiryTimer = this.heartbeatTimer = null
    const lease = this.lease
    this.lease = null
    this.unlisten?.()
    this.unlisten = null
    for (const channel of [this.control, this.screen]) {
      if (!channel) continue
      channel.onopen = channel.onclose = channel.onerror = channel.onmessage = null
      try { channel.close() } catch { /* Already closed. */ }
    }
    this.control = this.screen = null
    if (this.pc) {
      this.pc.onicecandidate = this.pc.onconnectionstatechange = this.pc.ondatachannel = null
      try { this.pc.close() } catch { /* Already closed. */ }
    }
    this.pc = null
    try { this.signaling?.close() } catch { /* A disconnected transport may throw on close. */ }
    this.signaling = null
    this.session = null
    this.approved = null
    this.captureStarting = false
    this.iceQueue = []
    this.inputQueue = []
    this.heldKeys.clear()
    this.heldButtons.clear()
    this.frames.clear()
    this.update({ status: failed ? 'error' : 'ended', invite: null, pending: [], controlEnabled: false, display: null, error: failed ? reason : null, endedReason: failed ? null : reason })
    if (lease) await this.deps.native.stop(lease.leaseId).catch(() => {})
  }

  dispose(): void {
    if (this.disposed) return
    void this.stop('The remote assistance page closed.')
    this.disposed = true
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.leave)
      window.removeEventListener('offline', this.leave)
      window.removeEventListener('blur', this.blur)
    }
  }
}
