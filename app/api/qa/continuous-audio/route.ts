import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'

// Isolated, expiring preview-only QA. Never grants access to app accounts,
// token minting endpoints, user recordings, arbitrary URLs or production routes.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180
const CAPABILITY_SHA256 = 'c3d16d02e1e0c3cbccb94ff5063f9e3d454ab23868e6e91d38d78901e202b6f3'
const EXPIRES_AT = 1790390406414
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('capability') || ''
  if (process.env.VERCEL_ENV !== 'preview' || Date.now() >= EXPIRES_AT || token.length > 100 || createHash('sha256').update(token).digest('hex') !== CAPABILITY_SHA256) return new Response(null, {status:404})
  const report: Record<string, unknown> = {
    status: 'preflight-only', commit:process.env.VERCEL_GIT_COMMIT_SHA,
    environment:process.env.VERCEL_ENV,
    configured: Object.fromEntries(['DEEPGRAM_API_KEY','ASSEMBLYAI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY'].map(key=>[key,Boolean(process.env[key])])),
    providerCalls:0, audioReplayed:false,
  }
  try {
    const url='https://static.deepgram.com/examples/interview_speech-analytics.wav'
    const res=await fetch(url,{headers:{Range:'bytes=0-65535'},signal:AbortSignal.timeout(15000),cache:'no-store'})
    const reader=res.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0
    if(reader){try{while(size<65536){const item=await reader.read();if(item.done)break;chunks.push(item.value);size+=item.value.length}}finally{await reader.cancel()}}
    const data=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))).subarray(0,65536)
    let fmt:unknown=null
    for(let i=12;i+8<data.length;){const n=data.readUInt32LE(i+4);if(data.toString('ascii',i,i+4)==='fmt ' && n>=16 && i+24<=data.length){fmt={encoding:data.readUInt16LE(i+8),channels:data.readUInt16LE(i+10),sampleRate:data.readUInt32LE(i+12),bits:data.readUInt16LE(i+22)};break}i+=8+n+(n%2)}
    report.source={url,status:res.status,type:res.headers.get('content-type'),header:data.toString('ascii',0,12),format:fmt}
  } catch {report.source={status:'unavailable'}}
  return Response.json(report,{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
}
