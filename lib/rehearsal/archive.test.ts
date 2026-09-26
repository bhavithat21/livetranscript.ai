// @vitest-environment node
import {expect,it} from 'vitest'
import {archiveEntry,MAX_REPORT_BYTES,saveRehearsal} from './archive'
const raw=(extras={})=>JSON.stringify({format:'livetranscript-interactive-rehearsal-v1',sessionId:'a',exportedAt:100,status:'ended',metadata:{title:'My interview'},...extras})
it('validates saved report identity and binds it to the authenticated owner',()=>{
 expect(archiveEntry('owner1',raw())).toMatchObject({owner:'owner1',sessionId:'a',ended:true,title:'My interview'})
 expect(()=>archiveEntry('',raw())).toThrow();expect(()=>archiveEntry('owner',raw({sessionId:''}))).toThrow();expect(()=>archiveEntry('owner','{}')).toThrow()
})
it('counts UTF-8 bytes and refuses oversize exports without deleting records',()=>{
 expect(archiveEntry('o',raw()).bytes).toBe(new TextEncoder().encode(raw()).byteLength)
 expect(()=>archiveEntry('o',raw({large:'a'.repeat(MAX_REPORT_BYTES)}))).toThrow('6 MB')
})
it('missing IndexedDB produces an explicit storage failure, not a fake save',async()=>{
 await expect(saveRehearsal('o',raw())).rejects.toThrow('unavailable')
})
