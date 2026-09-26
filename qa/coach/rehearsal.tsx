import { createRoot } from 'react-dom/client'
import { InteractiveRehearsal } from '@/components/rehearsal/InteractiveRehearsal'
import { InterviewTuningProvider } from '@/lib/interview/TuningContext'
import { injectSpeech } from './adapters/recorder'
import { parseContext } from '@/lib/coach/context'
import type { ContextPacket } from '@/lib/coach/types'
import '@/app/globals.css'
const requests: ContextPacket[]=[]
let configured=false
const originalFetch=window.fetch.bind(window)
window.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
  if(url==='/api/rehearsal/preflight')return Response.json({version:1,ready:configured,commit:'UI-fixture-not-a-production-commit',environment:'fixture',speech:{deepgram:configured,assemblyai:false},models:[{lane:'talk',model:'fixture-NOT-a-model',configured}],providerCalls:0})
  if(url==='/api/copilot/coach'){
    const body=JSON.parse(String(init?.body));const ctx=parseContext(body.context);requests.push(ctx)
    return new Response([...(body.lane==='talk'?[{type:'delta',text:'SCRIPTED test output, not a real answer.',model:'fixture-model'}]:[]),{type:'done',model:'fixture-model',guidance:null}].map(e=>JSON.stringify(e)).join('\n')+'\n',{headers:{'content-type':'application/x-ndjson'}})
  }
  if(url.includes('/api/')||/^https?:/.test(url))throw new Error('Unexpected external/API request in offline UI contracts')
  return originalFetch(input,init)
}
declare global {interface Window {__rehearsalQA:{configure:()=>void;speak:typeof injectSpeech;requests:()=>ContextPacket[]}}}
window.__rehearsalQA={configure:()=>{configured=true},speak:injectSpeech,requests:()=>requests}
createRoot(document.getElementById('root')!).render(<InterviewTuningProvider ownerId="qa-only"><p>OFFLINE UI CONTRACTS: synthetic recognition and responses. No actual ASR/vision/model test.</p><InteractiveRehearsal/></InterviewTuningProvider>)
