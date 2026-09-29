import type { DialogueTurn, ContextPacket, Lane } from './types'
export type MemoryItem={id:string;at:number;role:DialogueTurn['role'];summary:string;terms:string[]}
export type CompactedMemory={items:MemoryItem[];summary:string;compactedThrough:number;rawTurns:number}
const STOP=new Set(['the','this','that','with','from','have','what','when','where','would','could','should','about','your','into','then','than'])
function terms(text:string){return[...new Set((text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g)??[]).filter(x=>!STOP.has(x)))].slice(0,24)}
function sentence(text:string){return text.replace(/\s+/g,' ').trim().slice(0,360)}
/** Deterministic compaction: narrative history is compressed; authoritative task requirements/code/tests never enter this lossy path. */
export function compactDialogue(turns:DialogueTurn[],keepRecent=8):CompactedMemory{
 const old=turns.slice(0,Math.max(0,turns.length-keepRecent)),items=old.map(t=>({id:t.sourceId,at:t.at,role:t.role,summary:sentence(t.text),terms:terms(t.text)}))
 return{items:items.slice(-80),summary:items.slice(-20).map(i=>`${i.role}: ${i.summary}`).join('\n').slice(-5000),compactedThrough:old.at(-1)?.at??0,rawTurns:turns.length}
}
export function retrieveMemory(memory:CompactedMemory,query:string,limit=5):MemoryItem[]{const q=new Set(terms(query));return memory.items.map(item=>({item,score:item.terms.reduce((n,t)=>n+(q.has(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.item.at-a.item.at).slice(0,limit).map(x=>x.item)}
export function laneContextBudget(lane:Lane){return lane==='talk'?{recentTurns:5,memory:3,maxFiles:2,maxTests:1}:lane==='review'?{recentTurns:8,memory:6,maxFiles:6,maxTests:3}:{recentTurns:8,memory:5,maxFiles:6,maxTests:2}}
export function projectCompactedContext(packet:ContextPacket,lane:Lane){const b=laneContextBudget(lane),all=packet.conversation??[],memory=compactDialogue(all,b.recentTurns),query=`${packet.question.text} ${packet.task.objective} ${packet.task.requirements.join(' ')}`;return{recentConversation:all.slice(-b.recentTurns),memory:{summary:memory.summary,relevant:retrieveMemory(memory,query,b.memory),compactedThrough:memory.compactedThrough,rawTurns:memory.rawTurns},files:packet.files.slice(0,b.maxFiles),tests:packet.tests.slice(-b.maxTests)}}
