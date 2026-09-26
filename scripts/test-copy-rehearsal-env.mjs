import {test} from 'node:test'
import assert from 'node:assert/strict'
import {plannedVariables,addArgs,BRANCH} from './copy-rehearsal-env.mjs'
test('allowlist excludes database/billing/auth bypass and exposes names only',()=>{
 const names=plannedVariables({ANTHROPIC_API_KEY:'private-value-not-real',DATABASE_URL:'do-not-copy',ABLY_API_KEY:'do-not-copy',PREVIEW_NO_AUTH:'1',COPILOT_COACH_TALK_MODEL:'chosen-model'})
 assert.deepEqual(names,['ANTHROPIC_API_KEY','COPILOT_COACH_TALK_MODEL']);assert(!JSON.stringify(names).includes('private-value'))
})
test('only a complete test Clerk pair can be copied',()=>{
 assert.deepEqual(plannedVariables({CLERK_SECRET_KEY:'sk_live_secret',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_live_public'}),[])
 assert.deepEqual(plannedVariables({CLERK_SECRET_KEY:'sk_test_value'}),[])
 assert.equal(plannedVariables({CLERK_SECRET_KEY:'sk_test_value',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_test_value'}).length,2)
})
test('writes are preview branch scoped and never force overwrite',()=>{
 assert.deepEqual(addArgs('DEEPGRAM_API_KEY'),['env','add','DEEPGRAM_API_KEY','preview',BRANCH,'--sensitive']);assert.throws(()=>addArgs('DATABASE_URL'))
})
