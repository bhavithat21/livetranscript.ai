import { describe,it,expect } from 'vitest'
import { reviseSpeakers } from './speakerRevision'
import { assemblyResult } from './results'
const old={type:'Turn',end_of_turn:true,turn_order:1,transcript:'Hello. Hi.',speaker_label:'A',words:[{text:'Hello.',start:0,end:300,speaker:'A'},{text:'Hi.',start:400,end:600,speaker:'A'}]}
const change={turn_order:1,speaker_label:'B',words:[{...old.words[0],speaker:'A'},{...old.words[1],speaker:'B'}]}
describe('speaker revision evidence',()=>{
  it('preserves every original word and time while allowing a speaker split',()=>{
    const revised=reviseSpeakers(old,change)!
    expect(revised.transcript).toBe(old.transcript)
    expect(assemblyResult(revised,'one',s=>s==='A'?0:s==='B'?1:null)?.parts?.map(p=>p.speaker)).toEqual([0,1])
  })
  it.each([{...change,turn_order:2},{...change,words:[]},{...change,words:[{...change.words[0],text:'Modified'},change.words[1]]},{...change,words:[{...change.words[0],start:99},change.words[1]]}])('rejects incompatible revisions',revision=>expect(reviseSpeakers(old,revision)).toBeNull())
  it('missing per-word label may use turn label, but explicit PENDING never becomes identity',()=>{
    const data={...old,words:[{text:'Hello.',start:0,end:300},{text:'Hi.',start:400,end:600,speaker:'PENDING'}]}
    const event=assemblyResult(data,'one',s=>s==='A'?0:null)!
    expect(event.speaker).toBeNull();expect(event.parts?.map(p=>p.speaker)).toEqual([0,null])
  })
})
