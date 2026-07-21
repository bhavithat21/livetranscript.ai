'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import { type Segment } from '@/lib/transcript/store'
import { useRoom, type RoomRole } from '@/lib/room/useRoom'
import { mergeRoomSegments } from '@/lib/room/roomStore'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { AudioMeter } from '@/components/transcript/AudioMeter'
import type { TranscriptionProvider } from '@/lib/transcription/types'

const KEYTERMS = ['Kubernetes', 'idempotency', 'quantization', 'Kafka', 'AWS Lambda', 'system design']

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [role, setRole] = useState<RoomRole | null>(null)

  if (!role) return <RolePicker roomId={id} onPick={setRole} />
  return <Room roomId={id} role={role} />
}

function RolePicker({ roomId, onPick }: { roomId: string; onPick: (r: RoomRole) => void }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="font-[family-name:var(--font-serif)] text-3xl">Join shadowing room</h1>
      <p className="mt-2 text-black/60">Room {roomId}</p>
      <p className="mt-6 text-sm text-black/60">
        Be on a separate voice call so you can hear each other. Pick your role:
      </p>
      <div className="mt-6 flex justify-center gap-4">
        <button
          onClick={() => onPick('reader')}
          className="rounded-full border border-black/15 px-6 py-3 font-medium hover:bg-black/5"
        >
          I&rsquo;m reading
        </button>
        <button
          onClick={() => onPick('repeater')}
          className="rounded-full bg-emerald-700 px-6 py-3 font-medium text-white hover:bg-emerald-800"
        >
          I&rsquo;m repeating
        </button>
      </div>
    </main>
  )
}

function Room({ roomId, role }: { roomId: string; role: RoomRole }) {
  const { start, stop, error } = useMicStream()
  const { connected, error: roomError, publish, onPeer } = useRoom(roomId, role)
  const [segments, setSegments] = useState<Segment[]>([])
  const [level, setLevel] = useState(0)
  const [live, setLive] = useState(false)
  const providerRef = useRef<TranscriptionProvider | null>(null)

  // The repeater always gets the emphasis (their words big + dark), regardless of my role.
  const emphasizeSpeaker = 1

  // Subscribe to the peer's transcript on mount, so User 2 sees User 1's words
  // the moment they join — before starting their own mic.
  useEffect(() => {
    onPeer((m) => setSegments((s) => mergeRoomSegments(s, m)))
  }, [onPeer])

  const onStart = useCallback(async () => {
    try {
      let provider: TranscriptionProvider | null = null
      const rate = await start((pcm) => provider?.sendAudio(pcm), setLevel)
      const res = await connectWithFallback({ keyterms: KEYTERMS, sampleRate: rate, maxSpeakers: 2 })
      provider = res.provider
      providerRef.current = provider
      const relay = (e: Parameters<typeof publish>[0]) => {
        // show my own words locally AND send to peer
        setSegments((s) => mergeRoomSegments(s, { ...e, role }))
        publish(e)
      }
      provider.onPartial(relay)
      provider.onFinal(relay)
      setLive(true)
    } catch (e) {
      stop()
      alert(e instanceof Error ? e.message : 'Failed to start')
    }
  }, [start, stop, publish, role])

  const onStop = useCallback(async () => {
    stop()
    await providerRef.current?.disconnect()
    setLive(false)
    setLevel(0)
  }, [stop])

  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <header className="flex flex-wrap items-center gap-4 border-b border-black/10 px-6 py-3">
        {!live ? (
          <button
            onClick={onStart}
            className="rounded-full bg-emerald-700 px-5 py-2 font-medium text-white"
          >
            Start
          </button>
        ) : (
          <button
            onClick={onStop}
            className="rounded-full bg-red-700 px-5 py-2 font-medium text-white"
          >
            Stop
          </button>
        )}
        <AudioMeter level={level} />
        <span className="text-sm text-black/50">
          You: {role === 'reader' ? 'Reader (Speaker 1)' : 'Repeater (Speaker 2)'}
        </span>
        <span className={`text-sm ${connected ? 'text-emerald-700' : 'text-black/40'}`}>
          {connected ? '● room connected' : '○ connecting…'}
        </span>
        {(error || roomError) && (
          <span className="w-full text-sm text-red-700">{error ?? roomError}</span>
        )}
      </header>
      <TranscriptView
        segments={segments}
        theme="light"
        readerMode
        emphasizeSpeaker={emphasizeSpeaker}
        autoScroll={live}
      />
    </main>
  )
}
