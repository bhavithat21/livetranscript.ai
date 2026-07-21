import { useEffect, useRef, useState, useCallback } from 'react'
import * as Ably from 'ably'
import type { TranscriptEvent } from '@/lib/transcription/types'
import { speakerSlot } from './roomStore'

// A room message is a transcript event tagged with the sender's stable client id
// and their display name (from Clerk).
export type RoomMessage = TranscriptEvent & { sender: string; name?: string }

const INTERIM_THROTTLE_MS = 100

// A short, stable per-tab id used for Ably presence + speaker-slot assignment.
function makeClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(6))
  return 'u_' + btoa(String.fromCharCode(...b)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
}

// Syncs this client's transcript to everyone else in the meeting over one Ably
// channel (text only — audio is a separate call). Presence tracks the roster so
// each participant is assigned a stable speaker slot (0–4) and matching color.
export function useRoom(roomId: string, displayName?: string) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roster, setRoster] = useState<string[]>([])
  // Mirror roster into a ref so publish() always reads the CURRENT roster, not a
  // stale closure snapshot — otherwise a fast first utterance could publish with
  // an unassigned slot (-1) before the presence re-render lands.
  const rosterRef = useRef<string[]>([])
  const chanRef = useRef<Ably.RealtimeChannel | null>(null)
  const clientRef = useRef<Ably.Realtime | null>(null)
  const peerCbRef = useRef<(m: RoomMessage) => void>(() => {})
  const endCbRef = useRef<() => void>(() => {})
  const lastInterimAt = useRef(0)
  const clientIdRef = useRef<string>('')
  if (!clientIdRef.current) clientIdRef.current = makeClientId()
  const myClientId = clientIdRef.current
  const nameRef = useRef<string | undefined>(displayName)
  nameRef.current = displayName

  useEffect(() => {
    if (!roomId) return
    let closed = false
    const q = `room=${encodeURIComponent(roomId)}&clientId=${encodeURIComponent(myClientId)}`
    // Token is scoped server-side to exactly this room's channel.
    const client = new Ably.Realtime({ authUrl: `/api/ably-token?${q}`, clientId: myClientId })
    clientRef.current = client
    const channel = client.channels.get(`room:${roomId}`)
    chanRef.current = channel

    const down = () => {
      if (!closed) setConnected(false)
    }
    client.connection.on('connected', () => {
      if (!closed) setConnected(true)
    })
    client.connection.on('disconnected', down)
    client.connection.on('suspended', down)
    client.connection.on('failed', () => {
      if (!closed) {
        setConnected(false)
        setError('Realtime unavailable — check ABLY_API_KEY')
      }
    })

    // Presence → the live roster of participant client ids.
    const refreshRoster = async () => {
      try {
        const members = await channel.presence.get()
        if (closed) return
        const ids = members.map((m) => m.clientId).filter(Boolean) as string[]
        rosterRef.current = ids
        setRoster(ids)
      } catch {
        /* presence not ready yet */
      }
    }
    // presence subscribe/enter both return promises that reject if attach fails.
    Promise.resolve(channel.presence.subscribe(['enter', 'leave', 'present'], refreshRoster)).catch(
      () => {},
    )
    channel.presence.enter().then(refreshRoster).catch(() => {})

    // subscribe() returns a promise that rejects if the channel fails to attach
    // (e.g. token/connection dropped) — swallow so it's not an unhandled rejection.
    channel
      .subscribe('transcript', (msg) => {
        const data = msg.data as RoomMessage
        if (data.sender !== myClientId) peerCbRef.current(data) // ignore our own echoes
      })
      .catch(() => {})

    // Anyone ending the meeting broadcasts 'end' → every participant is notified.
    channel.subscribe('end', () => endCbRef.current()).catch(() => {})

    return () => {
      closed = true
      // A failed/connecting client throws "Connection closed" on close() — safe to ignore.
      try {
        channel.presence.unsubscribe()
        // leave() rejects async if the channel already detached — swallow it.
        channel.presence.leave().catch(() => {})
        channel.unsubscribe()
        client.close()
      } catch {
        /* connection already closed or never opened */
      }
      chanRef.current = null
      clientRef.current = null
    }
  }, [roomId, myClientId])

  // My deterministic speaker slot (0–4), or -1 if I'm past the 5-seat cap.
  const mySlot = speakerSlot(myClientId, roster)

  // Publish one of our transcript events, tagged with my slot + sender. Interims
  // throttled; finals always sent. Reads rosterRef (not the roster dep) so the
  // slot is always computed against the current roster, even mid-render-lag.
  const publish = useCallback(
    (e: TranscriptEvent) => {
      const ch = chanRef.current
      if (!ch) return
      const now = Date.now()
      if (!e.isFinal) {
        if (now - lastInterimAt.current < INTERIM_THROTTLE_MS) return
        lastInterimAt.current = now
      }
      const slot = speakerSlot(myClientId, rosterRef.current)
      ch.publish('transcript', {
        ...e,
        speaker: slot,
        sender: myClientId,
        name: nameRef.current,
      } satisfies RoomMessage)
    },
    [myClientId],
  )

  const onPeer = useCallback((cb: (m: RoomMessage) => void) => {
    peerCbRef.current = cb
  }, [])

  // Register a handler for when someone ends the meeting for everyone.
  const onEnd = useCallback((cb: () => void) => {
    endCbRef.current = cb
  }, [])

  // Broadcast that the meeting is over — all participants receive 'end'.
  const endMeeting = useCallback(() => {
    chanRef.current?.publish('end', { at: myClientId }).catch(() => {})
  }, [myClientId])

  return { connected, error, publish, onPeer, onEnd, endMeeting, roster, mySlot, myClientId }
}
