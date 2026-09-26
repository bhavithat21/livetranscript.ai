/** Device-local, same-origin storage. Never sends evidence to a server.
 * Account scoping prevents accidental cross-account reads, not access by
 * someone who controls this browser/profile. IndexedDB is not encryption. */
export type ArchivedRehearsal = { owner:string; sessionId:string; title:string; updatedAt:number; ended:boolean; bytes:number; report:string }
const STORE='sessions', DATABASE='livetranscript-rehearsals-v1'
export const MAX_ARCHIVE_BYTES=32_000_000, MAX_REPORT_BYTES=6_000_000, MAX_SESSIONS=30
export function archiveEntry(owner:string, report:string):ArchivedRehearsal {
  if(!owner||owner.length>160)throw new Error('Sign in before saving a rehearsal.')
  const bytes=new TextEncoder().encode(report).byteLength
  if(bytes>MAX_REPORT_BYTES)throw new Error('This session exceeds the 6 MB local save limit. Export it before leaving.')
  const data=JSON.parse(report)
  if(data.format!=='livetranscript-interactive-rehearsal-v1'||typeof data.sessionId!=='string'||!data.sessionId||data.sessionId.length>160||!Number.isFinite(data.exportedAt))throw new Error('Invalid rehearsal archive.')
  return {owner,sessionId:data.sessionId,title:String(data.metadata?.title||'Interview rehearsal').slice(0,140),updatedAt:data.exportedAt,ended:data.status==='ended',bytes,report}
}
function openArchive():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('Local session storage is unavailable. Export before leaving.'));return}
    const req=indexedDB.open(DATABASE,1)
    req.onupgradeneeded=()=>{const store=req.result.createObjectStore(STORE,{keyPath:['owner','sessionId']});store.createIndex('owner','owner')}
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(new Error('Could not open local session storage. Export before leaving.'))
    req.onblocked=()=>reject(new Error('Close older rehearsal tabs and retry local saving.'))
  })
}
export async function listRehearsals(owner:string):Promise<ArchivedRehearsal[]> {
  const db=await openArchive()
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).index('owner').getAll(owner)
    req.onsuccess=()=>resolve((req.result as ArchivedRehearsal[]).sort((a,b)=>b.updatedAt-a.updatedAt))
    req.onerror=()=>reject(new Error('Could not read saved rehearsals.'))
  })}finally{db.close()}
}
export async function saveRehearsal(owner:string,report:string):Promise<void> {
  const entry=archiveEntry(owner,report),db=await openArchive()
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE)
    let failure='Session was not saved. Storage may be full; export before leaving.'
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error(failure));tx.onabort=()=>reject(new Error(failure))
    const req=store.index('owner').getAll(owner)
    req.onsuccess=()=>{
      const rows=req.result as ArchivedRehearsal[],old=rows.find(r=>r.sessionId===entry.sessionId)
      if(old&&old.updatedAt>entry.updatedAt)return // Late autosaves cannot overwrite a newer final/review.
      if((!old&&rows.length>=MAX_SESSIONS)||rows.reduce((n,r)=>n+r.bytes,0)-(old?.bytes||0)+entry.bytes>MAX_ARCHIVE_BYTES){failure='Archive limit reached (30 sessions / 32 MB). Export and delete an old session; no records were removed automatically.';tx.abort();return}
      store.put(entry)
    }
  })}finally{db.close()}
}
export async function deleteRehearsal(owner:string,sessionId:string):Promise<void>{
  const db=await openArchive()
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete([owner,sessionId])
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('Could not delete saved rehearsal.'))
  })}finally{db.close()}
}
