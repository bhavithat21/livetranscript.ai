import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Home from '@/app/page'
import { SharedTranscriptDocument, ShareTopBar } from '@/components/transcript/SharedTranscriptDocument'
import { SettingsWorkspace } from '@/components/settings/SettingsWorkspace'
import type { Segment } from '@/lib/transcript/store'
import '@/app/globals.css'
import './generated-fonts.css'

// Authored examples only. Never copy a user's shared recording into this public fixture.
const snippets = ['Let’s review how the', 'notification service handles retries.', 'The queue gives us a durable boundary.', 'We should keep the original event ID', 'and make each delivery idempotent.', 'That avoids duplicate notifications when a worker restarts.', 'What happens if the recipient is unavailable?', 'Use bounded retries with exponential backoff.', 'After the retry budget is exhausted,', 'send the event to a dead-letter queue.', 'We can inspect it without blocking other deliveries.', 'Keep the attempt count and failure reason.', 'I’ll add a targeted test', 'for the duplicate delivery case.', 'Then verify the rest of the suite.']
const segments: Segment[] = snippets.map((text, index) => ({ id: index + 1, speaker: index < 6 ? 0 : index < 12 ? 1 : 0, text, isFinal: true, startMs: index * 3500, endMs: index * 3500 + 2200 }))
segments.push({ id: 16, speaker: 1, text: 'One more check…', isFinal: false, startMs: 55_000, endMs: 56_000 })
declare global { interface Window { __refinementQA: { show: (view: string) => void; expected: string[] } } }
function App() {
  const [view, setView] = useState('transcript')
  useEffect(() => { window.__refinementQA = { show: setView, expected: segments.map(segment => segment.text) } }, [])
  if (view === 'home') return <><ShareTopBar /><Home /></>
  if (view === 'settings') return <SettingsWorkspace />
  return <SharedTranscriptDocument title="Architecture review" createdAt="2026-09-25T17:00:00Z" durationSeconds={62} segments={segments} summary={{ summary: 'The team discussed durable delivery, bounded retries and idempotency. A targeted regression test will cover duplicate notifications.' }} />
}
createRoot(document.getElementById('root')!).render(<App />)
