import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { readRepoJson } from '@/lib/repo/agentHttp'
import { integer, object, text } from '@/lib/coach/validation'
import { lessonIds, parseDiagnostics } from '@/lib/coach/learning/policy'
import { evaluateLessonCase, evaluationModels, proposeLessons } from '@/lib/coach/learning/evaluate'
export const maxDuration=60
export async function POST(req:Request) {
  const user=await currentUserId()
  if(!user) return Response.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==new URL(req.url).origin) return Response.json({error:'Same-origin request required'},{status:403})
  if(!rateLimit(`coach-lessons:${user}`,14,60_000)) return Response.json({error:'Lesson evaluation budget reached. Try later.'},{status:429})
  let body:Record<string,unknown>
  try {body=object(await readRepoJson(req,12000),['action','active','candidate','diagnostics','caseId','repetition']);lessonIds(body.active);if(body.action==='evaluate') {lessonIds(body.candidate);integer(body.repetition,0,1)} else if(body.action!=='propose') throw new Error('Unknown action')}
  catch {return Response.json({error:'Invalid lesson request'},{status:400})}
  try { for(const lane of ['talk','guide','review'] as const) evaluationModels(lane) }
  catch {return Response.json({error:'Lesson evaluation needs configured coach providers and a separate COPILOT_LESSON_JUDGE_MODEL. No lesson has been activated.'},{status:503})}
  try {
    const signal=AbortSignal.any([req.signal,AbortSignal.timeout(55_000)]),active=lessonIds(body.active)
    const result=body.action==='propose'?{candidate:await proposeLessons(active,parseDiagnostics(body.diagnostics),signal)}:{comparison:await evaluateLessonCase(active,lessonIds(body.candidate),text(body.caseId,80,true),integer(body.repetition,0,1),signal)}
    return Response.json(result,{headers:{'Cache-Control':'no-store'}})
  } catch {return Response.json({error:'Lesson evaluation failed or was cancelled. Current policy is unchanged; no automatic retry.'},{status:502,headers:{'Cache-Control':'no-store'}})}
}
