import{describe,expect,it}from'vitest'
import{compactDialogue,retrieveMemory,projectCompactedContext}from'./memory'
import type{DialogueTurn,ContextPacket}from'./types'
const turns:DialogueTurn[]=Array.from({length:14},(_,i)=>({sourceId:`t${i}`,at:i,role:i%2?'candidate':'interviewer',text:i===2?'Do not add external dependencies':i===4?'We discussed a race in the shared cache':`ordinary turn ${i}`}))
function packet():ContextPacket{return{schema:1,sessionId:'s',permission:'practice',question:{id:'q',original:'Does the cache still race?',text:'Does the cache still race?',at:20},task:{objective:'Fix shared cache',requirements:['Thread safe'],constraints:['Do not add external dependencies.'],phase:'debug',implementation:'allowed',version:2},evidenceVersion:3,codeVersion:4,contextKey:'k',conversation:turns,files:Array.from({length:4},(_,i)=>({path:`F${i}.java`,language:'java',fileVersion:1,complete:true,fragments:[]})),knownPaths:[],relations:[],visibleView:null,tests:[],patches:[],patchReviews:[],budget:{maxCharacters:20000,usedCharacters:0,omittedPaths:[]}}}
describe('interview memory compaction',()=>{
 it('keeps recent turns verbatim and compacts only older narrative',()=>{const m=compactDialogue(turns,5);expect(m.rawTurns).toBe(14);expect(m.items.length).toBe(9);expect(m.compactedThrough).toBe(8)})
 it('retrieves older relevant discussion semantically without injecting all history',()=>{const m=compactDialogue(turns,5);expect(retrieveMemory(m,'shared cache race',3).some(x=>x.summary.includes('race'))).toBe(true)})
 it('uses a smaller projection for fast talk while authoritative requirements remain outside lossy memory',()=>{const p=packet(),talk=projectCompactedContext(p,'talk'),guide=projectCompactedContext(p,'guide');expect(talk.files.length).toBe(2);expect(guide.files.length).toBe(4);expect(p.task.constraints).toContain('Do not add external dependencies.');expect(talk.recentConversation.length).toBe(5)})
})
