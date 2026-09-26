#!/usr/bin/env node
/** Local owner-run helper. Requires `vercel login` and a linked project.
 * Uses the official CLI's in-memory env-run and stdin env-add interfaces.
 * No .env dump, secret in argv, credential return endpoint, or production write.
 * Docs: https://vercel.com/docs/cli/env
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BRANCH='fix/spoken-requirements-rehearsal-20260926'
export const PROJECT='prj_U1FL1N9LGnKAe2cTMc2W1l3ukboc',TEAM='team_lrZxZ9SjJD6F2CSeLAkfMtix'
const providers=['DEEPGRAM_API_KEY','ASSEMBLYAI_API_KEY','ANTHROPIC_API_KEY','GROQ_API_KEY','OPENAI_API_KEY']
const configs=['COPILOT_COACH_TALK_MODEL','COPILOT_COACH_GUIDE_MODEL','COPILOT_COACH_REVIEW_MODEL','COPILOT_REPO_MODEL_REQUIREMENTS','COPILOT_REPO_MODEL_IMPLEMENTATION','COPILOT_REPO_MODEL_REVIEWER','COPILOT_REPO_MODEL_VISION','COPILOT_REPO_BENCHMARK_POLICY']
export function plannedVariables(env) {
  const out=[...providers,...configs].filter(key=>typeof env[key]==='string'&&env[key].trim()&&env[key].length<32000&&!/your_|placeholder|xxxxxxxx/i.test(env[key]))
  // Live Clerk credentials may not authenticate a Preview domain. Never expand
  // production auth trust automatically: copy a test pair only.
  if(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')&&env.CLERK_SECRET_KEY?.startsWith('sk_test_'))out.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY')
  return out
}
export function addArgs(key){
  if(![...providers,...configs,'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY'].includes(key))throw new Error('Variable is not allowlisted')
  return ['env','add',key,'preview',BRANCH,'--sensitive'] // Deliberately no --force, rm or update.
}
function linkedProject(){
  try{const data=JSON.parse(readFileSync(resolve('.vercel/project.json'),'utf8'));return data.projectId===PROJECT&&data.orgId===TEAM}catch{return false}
}
export function main(argv=process.argv.slice(2),env=process.env,run=spawnSync) {
  if(argv.some(a=>!['--apply','--receive-production'].includes(a))){console.error('Usage: node scripts/copy-rehearsal-env.mjs [--apply]');return 2}
  if(!linkedProject()){console.error('Run vercel login, then vercel link for project livetranscript-ai in the existing team. This helper refuses any other project.');return 2}
  const apply=argv.includes('--apply')
  if(!argv.includes('--receive-production')){
    console.log(`Target: ${PROJECT} / Preview / ${BRANCH}`)
    console.log(apply?'Copying allowlisted variables only. Production values/targets are never modified. Existing Preview variables are not overwritten.':'Dry run: names/status only. No environment writes.')
    // The CLI obtains credentials using its normal authenticated session. Never
    // interpret CLI output as a key, print its error body, or persist it to disk.
    const args=['env','run','-e','production','--',process.execPath,resolve('scripts/copy-rehearsal-env.mjs'),'--receive-production',...(apply?['--apply']:[])]
    const r=run('vercel',args,{encoding:'utf8',timeout:120000,maxBuffer:1_000_000,env:{...env,LT_REHEARSAL_COPY_HELPER:'1'},windowsHide:true})
    const marker='REHEARSAL_ENV_REPORT:'
    const line=(r.stdout||'').split('\n').find(s=>s.startsWith(marker))
    if(!line){console.error('Vercel authentication/env retrieval did not complete. Check CLI login and access; no secrets or provider calls were exposed.');return 1}
    let report
    try{report=JSON.parse(line.slice(marker.length))}catch{console.error('Invalid helper report; no credentials printed.');return 1}
    // Only accept the fixed status vocabulary and names, never arbitrary child output.
    for(const item of report.items||[])if([...providers,...configs,'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY'].includes(item.key)&&['available','added','not-added'].includes(item.status))console.log(`${item.key}: ${item.status}`)
    console.log('Unreadable/sensitive source values cannot be copied; recreate those in Vercel using the original provider credential. Non-test Clerk pairs are not copied.')
    console.log('No database, billing, analytics, Ably, auth-bypass, or judge secrets copied. Provider usage shares billing with the copied keys. Set spend limits, then redeploy the Preview branch.')
    return r.status===0?0:1
  }
  if(env.LT_REHEARSAL_COPY_HELPER!=='1'){console.error('Run the helper without the internal flag.');return 2}
  const keys=plannedVariables(env),items=[]
  for(const key of keys){
    if(!apply){items.push({key,status:'available'});continue}
    // No shell; secret goes only to CLI stdin, not args/logs. Suppress raw outputs
    // because an API/CLI error might echo the submitted value.
    const r=run('vercel',addArgs(key),{input:env[key],stdio:['pipe','ignore','ignore'],timeout:20000,windowsHide:true})
    items.push({key,status:r.status===0?'added':'not-added'})
  }
  console.log('REHEARSAL_ENV_REPORT:'+JSON.stringify({items}))
  return items.some(i=>i.status==='not-added')||!keys.length?1:0
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=main()
