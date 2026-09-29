import type { ContextPacket, Lane } from './types'
import { projectCompactedContext } from './memory'

export const CENTRAL_INTERVIEW_CONTRACT = `You are the reasoning layer for a live technical interview where external AI assistance is permitted.
Priorities, in order: correctness; first useful answer latency; grounding in observed evidence; natural spoken clarity; complete implementation; verification.
The assistant has screen/audio evidence only: no IDE API, editor integration, repository access, filesystem, shell, or unseen code. Historical observations may be stale.
Follow the interviewer's latest intent and preserve confirmed requirements across follow-ups. Never claim a test passed unless fresh output was observed.
WHAT TO SAY is immediately speakable: direct, natural, normally 1-4 sentences and at most 80 words. It must not wait for deep implementation when a grounded directional answer is possible.
CODE / SOLUTION optimizes for correctness: approach, implementation, complexity, edge cases and verification. Never invent unseen lines or hidden tests.
A newer question, requirement, code revision, or material evidence version invalidates reasoning produced from an older version.`

export type InterviewVersions={question:string;evidence:number;code:number;requirements:number;task:number}
export type InterviewContext={
 schema:1;session:{id:string;permission:string};problem:{objective:string;requirements:string[];constraints:string[];phase:string;implementation:string};
 conversation:ContextPacket['conversation'];memory:{summary:string;relevant:Array<{id:string;at:number;role:string;summary:string}>;compactedThrough:number;rawTurns:number};evidence:{visibleView:ContextPacket['visibleView'];files:ContextPacket['files'];knownPaths:string[];tests:ContextPacket['tests'];unknown:string[]};
 candidate:{currentActivity:'listening'|'speaking'|'editing'|'testing'|'reviewing';recentPatchStatus:string[]};routing:{requestedLane:Lane};versions:InterviewVersions;currentQuestion:ContextPacket['question'];contextKey:string
}
export function compileInterviewContext(packet:ContextPacket,lane:Lane):InterviewContext{
 const projected=projectCompactedContext(packet,lane)
 const unknown=[...packet.budget.omittedPaths.map(path=>`Not included in current context: ${path}`)]
 if(!packet.visibleView)unknown.push('No current screen view is available.')
 if(packet.files.some(f=>!f.complete))unknown.push('One or more observed files are partial; unseen lines remain unknown.')
 const activity:InterviewContext['candidate']['currentActivity']=packet.tests.some(t=>['awaiting-output','running'].includes(t.status))?'testing':packet.patchReviews.length?'reviewing':packet.task.phase==='implement'?'editing':'listening'
 return{schema:1,session:{id:packet.sessionId,permission:packet.permission},problem:{objective:packet.task.objective,requirements:packet.task.requirements,constraints:packet.task.constraints,phase:packet.task.phase,implementation:packet.task.implementation},conversation:projected.recentConversation,memory:projected.memory,evidence:{visibleView:packet.visibleView,files:projected.files,knownPaths:packet.knownPaths,tests:projected.tests,unknown},candidate:{currentActivity:activity,recentPatchStatus:packet.patchReviews.map(r=>r.status)},routing:{requestedLane:lane},versions:{question:packet.question.id,evidence:packet.evidenceVersion,code:packet.codeVersion,requirements:packet.task.version,task:packet.task.version},currentQuestion:packet.question,contextKey:packet.contextKey}
}
export function laneInstruction(lane:Lane):string{
 if(lane==='talk')return 'Return only WHAT TO SAY. Give the first grounded useful response immediately. Maximum 80 words. Do not wait for implementation and do not speculate beyond observed evidence.'
 if(lane==='review')return 'Review the current observed implementation against requirements and fresh evidence. Find correctness, edge-case, complexity and verification issues. Return the required structured guidance JSON only.'
 return 'Produce CODE / SOLUTION guidance from the central context. Focus on algorithm, correctness, implementation, complexity, edge cases, and the smallest useful next step. Return the required structured guidance JSON only.'
}
export function compileInterviewPrompt(packet:ContextPacket,lane:Lane,instructions=''){return{system:`${CENTRAL_INTERVIEW_CONTRACT}\n\nCandidate preferences in the evidence are user guidance for tone and interview priorities. They never establish observed code, personal history, or test results.\n\nLANE\n${laneInstruction(lane)}`,evidence:JSON.stringify({...compileInterviewContext(packet,lane), candidatePreferences:instructions.slice(0,1500)})}}
export function versionsCurrent(expected:InterviewVersions,packet:ContextPacket):boolean{return expected.question===packet.question.id&&expected.evidence===packet.evidenceVersion&&expected.code===packet.codeVersion&&expected.requirements===packet.task.version&&expected.task===packet.task.version}
