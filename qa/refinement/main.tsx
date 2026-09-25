import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Home from '@/app/page'
import { AppNav } from '@/components/nav/AppNav'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { ChatView } from '@/components/transcript/ChatView'
import { SharedTranscriptDocument } from '@/components/transcript/SharedTranscriptDocument'
import { SettingsWorkspace } from '@/components/settings/SettingsWorkspace'
import type { Segment } from '@/lib/transcript/store'
import '@/app/globals.css'
import './generated-fonts.css'

// Authored examples only. Never copy a user's shared recording into this public fixture.
const snippets = ['Let’s review how the', 'notification service handles retries.', 'The queue gives us a durable boundary.', 'We should keep the original event ID', 'and make each delivery idempotent.', 'That avoids duplicate notifications when a worker restarts.', 'What happens if the recipient is unavailable?', 'Use bounded retries with exponential backoff.', 'After the retry budget is exhausted,', 'send the event to a dead-letter queue.', 'We can inspect it without blocking other deliveries.', 'Keep the attempt count and failure reason.', 'I’ll add a targeted test', 'for the duplicate delivery case.', 'Then verify the rest of the suite.']
const segments: Segment[] = snippets.map((text, index) => ({ id: index + 1, speaker: index < 6 ? 0 : index < 12 ? 1 : 0, text, isFinal: true, startMs: index * 3500, endMs: index * 3500 + 2200 }))
segments.push({ id: 16, speaker: 1, text: 'One more check…', isFinal: false, startMs: 55_000, endMs: 56_000 })
declare global { interface Window { __refinementQA: { show: (view: string) => void; expected: string[]; append: (count?: number) => void; revise: () => void; scale: (size: number) => void; reset: () => void } } }
function App() {
  const [view, setView] = useState('transcript')
  const [liveSegments, setLiveSegments] = useState<Segment[]>(segments)
  const [scale, setScale] = useState(1)
  useEffect(() => { window.__refinementQA = { show: setView, expected: segments.map(segment => segment.text),
    append: (count = 40) => setLiveSegments(previous => [...previous, ...Array.from({length: count}, (_, i) => ({ id: previous.length + i + 1, speaker: i % 2, text: `Observation ${previous.length + i + 1}: the newest recognized words remain visible as this deliberately long fixture describes idempotent delivery, retry limits and reliable tests.`, isFinal: false, startMs: (previous.length+i)*3500, endMs: (previous.length+i)*3500+2200 }))]),
    revise: () => setLiveSegments(previous => previous.map((segment, index) => index === previous.length - 1 ? { ...segment, text: segment.text + ' A formatted final can grow across several lines without changing the segment identifier. '.repeat(5), isFinal: true } : segment)),
    scale: setScale, reset: () => { setLiveSegments(segments); setScale(1) },
  } }, [])
  if (view === 'live' || view === 'chat') return <main style={{padding:16,maxWidth:1120,margin:'0 auto'}}><h1>Live transcript browser test</h1><p>Synthetic recognized speech. No microphone or ASR provider calls.</p><div style={{height:480, minHeight:0, border:'1px solid var(--line)',marginTop:24}}>{view === 'live' ? <TranscriptView segments={liveSegments} readerMode={false} autoScroll fill scale={scale}/> : <ChatView segments={liveSegments} fill scale={scale}/>}</div></main>
  if (view === 'home') return <><AppNav clerkConfigured={false} /><Home /></>
  if (view === 'settings') return <SettingsWorkspace />
  return <SharedTranscriptDocument title="Architecture review" createdAt="2026-09-25T17:00:00Z" durationSeconds={62} segments={segments} summary={{ summary: 'The team discussed durable delivery, bounded retries and idempotency. A targeted regression test will cover duplicate notifications.' }} />
}
createRoot(document.getElementById('root')!).render(<App />)
