import {emptyCoach,reduceCoach} from '../../lib/coach/state'
import {buildContext} from '../../lib/coach/context'
import {parseGuidance} from '../../lib/coach/validation'
import {currentSteps} from '../../lib/coach/inline/steps'
import type {SurfaceFrame} from '../../lib/coach/inline/geometry'
import type {EventPayload} from '../../lib/coach/types'
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