import { useEffect, useRef, useState, useCallback } from 'react'
import * as Ably from 'ably'
import type { TranscriptEvent } from '@/lib/transcription/types'

// A room message is a transcript event tagged with the sender's role.
export type RoomRole = 'reader' | 'repeater'
export type RoomMessage = TranscriptEvent & { role: RoomRole }

const INTERIM_THROTTLE_MS = 150

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
    const client = new Ably.Realtime({ authUrl: '/api/ably-token' })
    clientRef.current = client
    const channel = client.channels.get(`room:${roomId}`)
    chanRef.current = channel

    client.connection.on('connected', () => setConnected(true))
    client.connection.on('failed', () => setError('Realtime connection failed'))

    channel.subscribe('transcript', (msg) => {
      const data = msg.data as RoomMessage
      if (data.role !== role) peerCbRef.current(data) // ignore our own echoes
    })

    return () => {
      channel.unsubscribe()
      client.close()
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
