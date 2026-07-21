import { useEffect, useRef, useState, useCallback } from 'react'
import * as Ably from 'ably'
import type { TranscriptEvent } from '@/lib/transcription/types'

// A room message is a transcript event tagged with the sender's role.
export type RoomRole = 'reader' | 'repeater'
export type RoomMessage = TranscriptEvent & { role: RoomRole }

const INTERIM_THROTTLE_MS = 100

// Syncs this client's transcript to the peer over an Ably channel (text only).
// Each client publishes under its own role; both render both streams via Shadow Mode.
export function useRoom(roomId: string, role: RoomRole) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chanRef = useRef<Ably.RealtimeChannel | null>(null)
  const clientRef = useRef<Ably.Realtime | null>(null)
  const peerCbRef = useRef<(m: RoomMessage) => void>(() => {})
  const lastInterimAt = useRef(0)

  useEffect(() => {
    if (!roomId) return
    let closed = false
    // Token is scoped server-side to exactly this room's channel.
    const client = new Ably.Realtime({
      authUrl: `/api/ably-token?room=${encodeURIComponent(roomId)}`,
    })
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

    channel.subscribe('transcript', (msg) => {
      const data = msg.data as RoomMessage
      if (data.role !== role) peerCbRef.current(data) // ignore our own echoes
    })

    return () => {
      closed = true
      // A failed/connecting client throws "Connection closed" on close() — safe to ignore.
      try {
        channel.unsubscribe()
        client.close()
      } catch {
        /* connection already closed or never opened */
      }
      chanRef.current = null
      clientRef.current = null
    }
  }, [roomId, role])

  // Publish one of our transcript events. Interims throttled; finals always sent.
  const publish = useCallback(
    (e: TranscriptEvent) => {
      const ch = chanRef.current
      if (!ch) return
      const now = Date.now()
      if (!e.isFinal) {
        if (now - lastInterimAt.current < INTERIM_THROTTLE_MS) return
        lastInterimAt.current = now
      }
      ch.publish('transcript', { ...e, role } satisfies RoomMessage)
    },
    [role],
  )

  const onPeer = useCallback((cb: (m: RoomMessage) => void) => {
    peerCbRef.current = cb
  }, [])

  return { connected, error, publish, onPeer }
}
