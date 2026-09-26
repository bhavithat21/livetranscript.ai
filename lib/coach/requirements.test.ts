// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CoachController, type CoachTransport } from './controller'
import { VirtualClock } from './simulation/clock'
import { buildContext, parseContext } from './context'
import { projectRequirements, requirementDirective, updateRequirementInputs, type RequirementInput } from './requirements'
import type { DialogueTurn, ContextPacket } from './types'

const updates = ['Now allow diagonal moves.', 'Add a restart button.', 'The board can now have blocked cells.', 'Actually repeated guesses should not cost a life.', 'We need this to work for ten thousand nodes.']
function setup() {
  const clock = new VirtualClock(), packets: ContextPacket[] = []; let id=0
  const transport: CoachTransport = async (lane, packet, o) => { packets.push(packet); if(lane==='talk') o.delta('Scripted output only.', 'fixture'); return {model:'fixture',guidance:null} }
  const c = new CoachController(transport,clock.now,()=>`r-${++id}`,'requirements-test',clock)
  c.start('practice','Find a route through the grid.')
  c.observe({ files: [], visiblePaths: ['src/maze.ts'], terminal:'', requirements:[] })
  c.question('Can you find a route through this maze?')
  const say=(text:string,sourceId=`voice:${++id}`,role:DialogueTurn['role']='interviewer',at=clock.now())=>c.dialogue({sourceId,text,role,at})
  return {c,clock,packets,say}
}
describe('durable spoken requirement ingestion',()=>{
  for(const update of updates) it(`reacts to: ${update}`,async()=>{
    const {c,clock,packets,say}=setup()
    try { await clock.advance(3000); const before=packets.length; say(update); await clock.advance(3000)
      expect(packets.length-before).toBe(2)
      expect(c.getSnapshot().task.spokenRequirements?.length).toBe(1)
      expect(parseContext(buildContext(c.getSnapshot())).task.spokenRequirements).toEqual(c.getSnapshot().task.spokenRequirements)
    } finally{c.dispose()}
  })
  it('ignores candidate, unknown, quoted, speculative and question speech',async()=>{
    const {c,clock,packets,say}=setup()
    try { await clock.advance(3000);const before=packets.length
      say('Add a restart button.','c','candidate'); say('Allow diagonal moves.','u','unknown')
      for(const text of ['Maybe allow diagonal moves.','Could we add a restart button?','The candidate says add a restart button.','"Add a restart button."']){say(text);await clock.advance(900)}
      expect(c.getSnapshot().task.spokenRequirements??[]).toEqual([]);expect(packets.length).toBe(before)
    }finally{c.dispose()}
  })
  it('settles fragments, suppresses repeats and preserves final ASR correction identity',async()=>{
    const {c,clock,packets,say}=setup()
    try {await clock.advance(3000);const before=packets.length;const at=clock.now()
      say('Now allow','call:a','interviewer',at);await clock.advance(900);expect(packets.length).toBe(before)
      say('diagonal moves.','call:b','interviewer',at+500);await clock.advance(2000)
      expect(c.getSnapshot().task.spokenRequirements?.map(r=>r.text)).toEqual(['allow diagonal moves'])
      const count=packets.length
      say('diagonal moves.','call:b','interviewer',at+500);await clock.advance(2000);expect(packets.length).toBe(count)
      say('Now do not allow','call:a','interviewer',at);await clock.advance(2000)
      expect(c.getSnapshot().task.spokenRequirements?.map(r=>r.text)).toEqual(['do not allow diagonal moves'])
    }finally{c.dispose()}
  })
  it('rolls back a misattributed requirement and persists across conversation eviction and replay',async()=>{
    const {c,clock,say}=setup()
    try {await clock.advance(3000);const at=clock.now();say('Allow diagonal moves.','voice:source','interviewer',at);await clock.advance(1800)
      say('Allow diagonal moves.','voice:source','candidate',at);await clock.advance(1800)
      expect(c.getSnapshot().task.spokenRequirements).toEqual([])
      say('Add a restart button.','voice:rule');await clock.advance(1800)
      for(let i=0;i<35;i++){say(`I am explaining step ${i}.`,`candidate:${i}`,'candidate');await clock.advance(10)}
      expect(c.getSnapshot().conversation?.some(r=>r.sourceId==='voice:rule')).toBe(false)
      expect(buildContext(c.getSnapshot()).task.spokenRequirements?.[0].text).toBe('Add a restart button')
      c.end(); const replay=new CoachController(async()=>{throw new Error('No calls during replay')})
      replay.loadReplay(c.exportReplay());expect(replay.getSnapshot().task.spokenRequirements).toEqual(c.getSnapshot().task.spokenRequirements);replay.dispose()
    }finally{c.dispose()}
  })
  it('does not duplicate identical directives from distinct packets or regenerate on replay',async()=>{
    const {c,clock,packets,say}=setup()
    try {await clock.advance(3000);say('Add a restart button.','one');await clock.advance(1800);const count=packets.length
      say('Add a restart button.','two');await clock.advance(1800);expect(packets.length).toBe(count)
      c.pause();say('Remove the restart button.','paused');await clock.advance(1000);expect(packets.length).toBe(count)
    }finally{c.dispose()}
  })
})
const inp=(text:string,sourceId:string,at:number):RequirementInput=>({text,sourceId,at,role:'interviewer'})
it('supports unique replacement/retraction and preserves negation, fails closed for ambiguous targets',()=>{
  let inputs:RequirementInput[]=[]
  for(const [i,text] of ['Allow diagonal moves.','Add a restart button.','Replace diagonal moves with orthogonal moves only.','Retract the requirement to add a restart button.'].entries())inputs=updateRequirementInputs(inputs,inp(text,String(i),i))
  expect(projectRequirements(inputs).active.map(r=>r.text)).toEqual(['orthogonal moves only'])
  inputs=updateRequirementInputs(inputs,inp('Ignore that.','amb',10))
  expect(projectRequirements(inputs).active).toHaveLength(1);expect(projectRequirements(inputs).pending).toHaveLength(1)
  inputs=updateRequirementInputs(inputs,inp('Drop the last requirement.','drop',11))
  expect(projectRequirements(inputs).active).toHaveLength(0)
})
it('rejects false exact-topic matches, late captures, and truncation of active history',()=>{
  expect(requirementDirective('Allow')).toBeNull()
  let inputs:RequirementInput[]=[]
  for(let i=0;i<160;i++)inputs=updateRequirementInputs(inputs,inp(`Add feature number ${i}.`,String(i),i))
  expect(()=>updateRequirementInputs(inputs,inp('Add one more feature.','extra',200))).toThrow('full')
  expect(projectRequirements(inputs).active).toHaveLength(160)
  expect(updateRequirementInputs(inputs,inp('Allow different things.','2',0))).toBe(inputs)
})
it('differentiates the lifetime budget from per-minute limits and extends only with paused explicit consent',async()=>{
  const {c,clock}=setup()
  try {await clock.advance(40000)
    for(let n=1;n<=65;n++){c.question(`How should we handle case ${n}?`);await clock.advance(40000)}
    expect(c.getMetrics().modelRequests).toBe(120);expect(c.getSnapshot().warning).toContain('Waiting will not reset')
    expect(c.extendSessionBudget()).toBe(false)
    c.pause();expect(c.extendSessionBudget()).toBe(true);c.resume();await clock.advance(2000)
    expect(c.getMetrics().sessionLimit).toBe(160);expect(c.getMetrics().modelRequests).toBe(122)
  }finally{c.dispose()}
})
it('removes a stitched directive when a constituent packet is reassigned to the candidate',async()=>{
  const {c,clock,say}=setup()
  try {
    await clock.advance(3000);const at=clock.now()
    say('Now allow','call:start','interviewer',at)
    say('diagonal moves.','call:tail','interviewer',at+100)
    await clock.advance(2000)
    expect(c.getSnapshot().task.spokenRequirements).toHaveLength(1)
    say('diagonal moves.','call:tail','candidate',at+100)
    await clock.advance(2000)
    expect(c.getSnapshot().task.spokenRequirements).toHaveLength(0)
  } finally { c.dispose() }
})
it('never publishes a late answer made against superseded spoken requirements',async()=>{
  const clock=new VirtualClock();let id=0
  const transport:CoachTransport=async(lane,packet,o)=>{
    await new Promise<void>(resolve=>clock.setTimeout(resolve,2500)) // deliberately ignores AbortSignal
    if(lane==='talk')o.delta(`version ${packet.task.version}`,'fixture')
    return {model:'fixture',guidance:null}
  }
  const c=new CoachController(transport,clock.now,()=>String(++id),'stale-requirement-test',clock)
  try {
    c.start('practice','Find a route.');c.question('How do we solve this maze?')
    await clock.advance(100)
    c.dialogue({sourceId:'call:new-rule',at:clock.now(),role:'interviewer',text:'Allow diagonal moves.'})
    await clock.advance(5000)
    const current=c.getSnapshot()
    expect(current.task.spokenRequirements).toHaveLength(1)
    expect(current.results.filter(r=>r.status==='complete').every(r=>r.taskVersion===current.task.version)).toBe(true)
    expect(current.results.filter(r=>r.status==='running')).toEqual([])
    expect(current.results.some(r=>r.status==='complete'&&r.text===`version ${current.task.version}`)).toBe(true)
  } finally { c.dispose() }
})
