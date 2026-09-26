import { describe,it,expect } from 'vitest'
import { parseLineRects,placeCallout,intersects,project,type SurfaceFrame } from './geometry'
import { currentSteps,editSteps,locateStep } from './steps'
import { emptyCoach,reduceCoach } from '../state'
import { buildContext } from '../context'
import { parseGuidance,parseObservation } from '../validation'
import { parseScreenObservation } from '../../repo/screenEvidence'
import type { EventPayload,Patch } from '../types'
function patch(before:string,after:string):Patch{return {id:'p',path:'src/rules.ts',startLine:10,fileVersion:1,before,after,reason:'Check both transition conditions.',evidence:[]}}
export function inlineFixture(){
 let state=emptyCoach('inline-fixture'),id=0
 const dispatch=(e:EventPayload)=>{state=reduceCoach(state,{...e,id:`e${++id}`,at:1000+id,sessionId:state.sessionId})}
 dispatch({type:'session.start',permission:'practice',objective:'Fix the transition rule.'})
 dispatch({type:'screen.observed',origin:'screen',observation:{files:[{path:'src/rules.ts',language:'typescript',startLine:10,lines:['if (ready || paid) {','  ship();','}'],confidence:1,endOfFile:false,lineRects:[{line:10,rect:{x:.1,y:.25,width:.36,height:.035}},{line:11,rect:{x:.1,y:.285,width:.2,height:.035}},{line:12,rect:{x:.1,y:.32,width:.03,height:.035}}]}],requirements:[],visiblePaths:['src/rules.ts'],terminal:''}})
 dispatch({type:'question.new',original:'How should this transition be checked?',text:'How should this transition be checked?'})
 const context=buildContext(state)
 const guidance=parseGuidance({summary:'Require both conditions.',look:[],findings:[],verify:[],hypotheses:[],patches:[{path:'src/rules.ts',startLine:10,fileVersion:1,before:'if (ready || paid) {',after:'if (ready && paid) {',reason:'I’ll require both readiness and payment before shipping.'}]},context)
 dispatch({type:'result.start',lane:'guide',requestId:'r',questionId:state.question!.id,evidenceVersion:state.evidenceVersion,contextKey:context.contextKey})
 dispatch({type:'result.complete',requestId:'r',model:'fixture',guidance})
 const surface:SurfaceFrame={key:'frame1',sourceId:'native-lease',sampledAt:2000,focused:true,viewport:{width:1440,height:900},source:{x:0,y:0,width:1440,height:900}}
 return {state,surface,step:currentSteps(state)[0]}
}
describe('inline edit steps',()=>{
 it('does not include unchanged lines',()=>expect(editSteps(patch('a\nb\nc','a\nx\nc')).map(s=>[s.line,s.before,s.after])).toEqual([[11,'b','x']]))
 it('makes equally sized replacement hunks line-specific',()=>expect(editSteps(patch('a\nb','x\ny'))).toHaveLength(2))
 it('anchors insert-before to an existing source line',()=>expect(editSteps(patch('a\nb','a\nx\nb'))[0]).toMatchObject({anchorLine:11,operation:'insert-before',after:'x'}))
 it('anchors EOF insert-after to the last observed line',()=>expect(editSteps(patch('a','a\nx'))[0]).toMatchObject({anchorLine:10,operation:'insert-after'}))
 it('represents removals without inventing replacement code',()=>expect(editSteps(patch('a\nb','b'))[0]).toMatchObject({operation:'delete',before:'a',after:''}))
 it('bounds diff computation',()=>expect(editSteps(patch(Array(121).fill('a').join('\n'),'b'))).toEqual([]))
})
describe('geometry and collision safety',()=>{
 it('projects normalized source geometry at display scale without guessing line height',()=>{const {surface}=inlineFixture();surface.source={x:100,y:50,width:800,height:600};expect(project({x:.1,y:.2,width:.2,height:.04},surface)).toEqual({x:180,y:170,width:160,height:24})})
 it('omits absent optional metadata',()=>expect(parseLineRects(undefined,10,['a'])).toBeUndefined())
 for(const rect of [{x:-.1,y:0,width:.2,height:.02},{x:.9,y:0,width:.2,height:.02},{x:0,y:NaN,width:.2,height:.02},{x:0,y:0,width:0,height:.02}])it(`rejects invalid rect ${JSON.stringify(rect)}`,()=>expect(()=>parseLineRects([{line:10,rect}],10,['a'])).toThrow())
 it('never extrapolates missing rows',()=>expect(()=>parseLineRects([{line:11,rect:{x:0,y:0,width:.2,height:.02}}],10,['a'])).toThrow())
 it('rejects duplicate anchors',()=>expect(()=>parseLineRects([{line:10,rect:{x:0,y:0,width:.2,height:.02}},{line:10,rect:{x:0,y:.2,width:.2,height:.02}}],10,['a'])).toThrow())
 for(const width of [375,768,1024,1280,1440,1920,2560])it(`callouts stay on-screen and outside target at ${width}`,()=>{
   for(const x of [16,width*.4,width-100])for(const y of [20,400,770]){
     const target={x,y,width:80,height:20},out=placeCallout(target,{width,height:900})
     if(out){expect(intersects(out.rect,target)).toBe(false);expect(out.rect.x).toBeGreaterThanOrEqual(12);expect(out.rect.x+out.rect.width).toBeLessThanOrEqual(width-12);expect(out.rect.y+out.rect.height).toBeLessThanOrEqual(888)}
   }
 })
 it('does not cover a target when there is no room',()=>expect(placeCallout({x:12,y:12,width:350,height:270},{width:375,height:300})).toBeNull())
})
describe('evidence and lifetime gates',()=>{
 it('locates an exact current preimage',()=>{const f=inlineFixture();expect(f.step).toBeTruthy();expect(locateStep(f.state,f.step,f.surface,'frame1',2100)).not.toBeNull()})
 it('does not blink off when the render timer trails a newer local sample',()=>{const f=inlineFixture();expect(locateStep(f.state,f.step,f.surface,'frame1',1900)).not.toBeNull()})
 it('does not put screen coordinates into the reasoning context',()=>{const f=inlineFixture();expect(JSON.stringify(buildContext(f.state))).not.toContain('lineRects')})
 for(const cause of ['scroll','age','focus','file','version','hold','stale','missing-row','import','ambiguous-row'])it(`hides the pin after ${cause}`,()=>{
   const f=inlineFixture();let key='frame1',now=2100
   if(cause==='scroll')key='frame2';if(cause==='age')now=4000;if(cause==='focus')f.surface.focused=false
   if(cause==='file')f.state.lastScreen!.observation.files[0].path='src/other.ts'
   if(cause==='version')f.state.files[0].version++
   if(cause==='hold')f.state.task.implementation='hold'
   if(cause==='stale')f.state.results[0].status='stale'
   if(cause==='missing-row')delete f.state.lastScreen!.observation.files[0].lineRects
   if(cause==='import')f.state.sources[0].origin='file-import'
   if(cause==='ambiguous-row')f.state.lastScreen!.observation.files.push({...f.state.lastScreen!.observation.files[0]})
   expect(locateStep(f.state,f.step,f.surface,key,now)).toBeNull()
 })
 it('validates coordinate metadata at BOTH extraction boundaries',()=>{const f=inlineFixture(),o=f.state.lastScreen!.observation;expect(parseObservation(parseScreenObservation(o)).files[0].lineRects).toHaveLength(3)})
})
