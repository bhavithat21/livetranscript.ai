import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { LiveInterview } from '@/components/interview/LiveInterview'
import { InterviewTuningProvider } from '@/lib/interview/TuningContext'
import { injectSpeech } from './adapters/recorder'
import { parseContext } from '@/lib/coach/context'
import { parseGuidance } from '@/lib/coach/validation'
import type { ContextPacket, Observation } from '@/lib/coach/types'
import '@/app/globals.css'
const path = 'src/services/TrackingService.ts'
const before = '  return current === "PROCESSING" || next === "SHIPPED";'
const after = '  return current === "PROCESSING" && next === "SHIPPED";'
const source: Observation = {
  files: [{ path, language: 'typescript', startLine: 1, lines: ['export function accepts(current: string, next: string) {', before, '}'], confidence: 1, endOfFile: true }],
  visiblePaths: [path, 'tests/TrackingService.test.ts'], terminal: '', requirements: ['Only PROCESSING orders may become SHIPPED. Preserve the public API.'],
}
const calls: Array<{ lane: string; context: ContextPacket }> = []
const answerCalls: Array<{question:string; aborted:boolean}> = []
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === '/api/copilot/classify') return Response.json({result:{mode:'general',isQuestion:true,needsWeb:false,confidence:1}})
  if (url === '/api/copilot/answer') {
    const body=JSON.parse(String(init?.body)); const call={question:String(body.question),aborted:false};answerCalls.push(call)
    const encoder=new TextEncoder()
    let timer:ReturnType<typeof setTimeout>
    const stream=new ReadableStream<Uint8Array>({ start(controller){
      let closed=false
      const abort=()=>{if(closed)return;closed=true;clearTimeout(timer);call.aborted=true;controller.close()}
      init?.signal?.addEventListener('abort',abort,{once:true})
      if(init?.signal?.aborted){abort();return}
      timer=setTimeout(()=>{
        if(closed)return;closed=true
        controller.enqueue(encoder.encode(`**Fixture response — not a model evaluation.**\n\nFor this question: ${call.question}\n\nI would move the long-running report into a background job, return a job identifier, and provide a status endpoint with clear failure and cancellation states.`))
        controller.close();init?.signal?.removeEventListener('abort',abort)
      }, /slow fixture/i.test(call.question)?30000:120)
    },cancel(){clearTimeout(timer)}})
    return new Response(stream,{headers:{'Content-Type':'text/plain'}})
  }
  if (url === '/api/copilot/repo-screen') return Response.json({ observation: source, model: 'fixture-vision-NOT-a-model' })
  if (url === '/api/copilot/coach') {
    const body = JSON.parse(String(init?.body)), context = parseContext(body.context)
    calls.push({ lane: body.lane, context })
    if (init?.signal?.aborted) throw new DOMException('Fixture cancelled', 'AbortError')
    let messages: object[]
    if (body.lane === 'talk') messages = [
      { type: 'delta', text: 'I would trace the status transition in the service, check that both sides of the condition are required, then verify the rejected states.', model: 'fixture-talk-NOT-a-model' },
      { type: 'done', model: 'fixture-talk-NOT-a-model', guidance: null },
    ]
    else {
      const file = context.files.find(file => file.path === path)
      const guidance = parseGuidance({ summary: 'Require both sides of the observed transition contract.', look: [{ path: 'tests/TrackingService.test.ts', startLine: null, endLine: null, symbol: '', reason: 'Inspect rejected-state assertions.' }], patches: file ? [{ path, fileVersion: file.fileVersion, startLine: 2, before, after, reason: 'Both origin and destination must match.' }] : [], findings: [], hypotheses: [], verify: [] }, context)
      messages = [{ type: 'done', guidance, model: 'fixture-guide-NOT-a-model' }]
    }
    return new Response(messages.map(message => JSON.stringify(message)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
  }
  // Vite module/HMR assets may use fetch; no product/API provider calls are allowed.
  if (url.includes('/api/') || /^https?:/.test(url)) throw new Error(`Unexpected live QA network request: ${url}`)
  return originalFetch(input, init)
}
declare global { interface Window { __liveQA: { speak: (text: string, source?: string, speaker?: number | null) => void; answers: () => Array<{question:string;aborted:boolean}>; calls: () => Array<{ lane: string; context: ContextPacket }> } } }
window.__liveQA = { speak: injectSpeech, answers:()=>[...answerCalls], calls: () => [...calls] }
function App() {
  const [completed, setCompleted] = useState(false)
  return <InterviewTuningProvider ownerId="fixture-account"><WorkspaceShell active="interview"><main style={{ padding: 'clamp(12px, 2vw, 28px)', minWidth: 0 }}><p style={{ fontSize: 12, marginBottom: 16 }}>Integrated Live UI QA · synthetic audio, screen extraction, and model responses · no provider calls</p>{completed && <p role="status">Fixture transcript completed</p>}<LiveInterview visible blocked={false} onActivity={() => {}} onComplete={() => setCompleted(true)} /></main></WorkspaceShell></InterviewTuningProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
