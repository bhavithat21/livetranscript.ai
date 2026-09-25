import { describe, it, expect } from 'vitest'
import { liveTurns, voiceLabel, type ChannelSegment } from './liveTurns'
const row=(id:number,text:string,more:Partial<ChannelSegment>={}):ChannelSegment=>({id,text,channel:'call',speaker:0,capturedAt:id*100,isFinal:true,...more})
describe('readable live voice turns',()=>{
  it('groups short chunks without losing or rewriting words',()=>{
    const turns=liveTurns([row(1,'This is going to'),row(2,'be different.'),row(3,'You may use AI.')])
    expect(turns).toHaveLength(1);expect(turns[0].parts.map(p=>p.text).join(' ')).toBe('This is going to be different. You may use AI.')
  })
  it('keeps voice, channel, and stream boundaries separate',()=>{
    expect(liveTurns([row(1,'One'),row(2,'Two',{speaker:1}),row(3,'Three',{speaker:1,channel:'mic'}),row(4,'Four',{speaker:1,channel:'mic',utteranceId:'new:1'})])).toHaveLength(4)
  })
  it('retains provisional text and unknown voices without inventing identities',()=>{
    const turns=liveTurns([row(1,'Uncertain',{speaker:null,isFinal:false})])
    expect(turns[0].parts[0].isFinal).toBe(false)
    expect(voiceLabel('call',null)).toContain('pending')
    expect(voiceLabel('call',1)).toBe('Call · Speaker 2')
    expect(voiceLabel('call',1,1)).toBe('Interviewer · Speaker 2')
  })
  it('orders revised split-word parts by original word time',()=>{
    const turns=liveTurns([row(2,'later',{capturedAt:100,startMs:500}),row(1,'first',{capturedAt:100,startMs:0})])
    expect(turns.flatMap(t=>t.parts.map(p=>p.text))).toEqual(['first','later'])
  })
})
