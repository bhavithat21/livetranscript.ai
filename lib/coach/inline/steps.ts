import type { CoachState, Patch } from '../types'
import { resultCurrent } from '../state'
import { project, type Rect, type SurfaceFrame } from './geometry'
export type EditStep = { id:string;patchId:string;path:string;fileVersion:number;line:number;anchorLine:number;before:string;after:string;operation:'replace'|'insert-before'|'insert-after'|'delete';say:string }
/** Bounded LCS: equal-sized replacement hunks become line-specific steps;
 * insert/delete blocks stay together rather than inventing non-existent rows. */
export function editSteps(patch:Patch):EditStep[] {
  const a=patch.before.split('\n'),b=patch.after ? patch.after.split('\n') : []
  if(a.length>120||b.length>120)return []
  const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1))
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1])
  const output:EditStep[]=[]
  let i=0,j=0
  function add(start:number,removed:string[],added:string[]) {
    const op=removed.length?(added.length?'replace':'delete'):(start<a.length?'insert-before':'insert-after')
    const anchorLine=patch.startLine+Math.min(start,a.length-1)
    output.push({id:`${patch.id}:${output.length}`,patchId:patch.id,path:patch.path,fileVersion:patch.fileVersion,line:patch.startLine+start,anchorLine,before:removed.join('\n'),after:added.join('\n'),operation:op,say:patch.reason})
  }
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;continue}
    const start=i,removed:string[]=[],added:string[]=[]
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j])break
      if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j]))added.push(b[j++]);else removed.push(a[i++])
    }
    if(removed.length===added.length&&removed.length>1)removed.forEach((line,index)=>add(start+index,[line],[added[index]]));else add(start,removed,added)
  }
  return output
}
export function currentSteps(state:CoachState):EditStep[]{
  if(state.status!=='running'||state.task.implementation==='hold')return []
  const result=state.results.findLast(r=>r.lane==='guide'&&r.status==='complete'&&r.guidance&&resultCurrent(r,state))
  return result?.guidance?.patches.flatMap(editSteps)??[]
}
export function locateStep(state:CoachState,step:EditStep,surface:SurfaceFrame|null,acceptedKey:string|null,now:number):{rect:Rect;sourceId:string}|null{
  if(!surface||!surface.focused||surface.key!==acceptedKey||now-surface.sampledAt>1200||surface.sampledAt-now>1000||state.status!=='running'||state.task.implementation==='hold')return null
  if(!currentSteps(state).some(item=>item.id===step.id))return null
  const screen=state.lastScreen,source=state.sources.find(s=>s.id===screen?.sourceId)
  if(!screen||source?.origin!=='screen')return null
  const file=state.files.find(f=>f.path===step.path&&f.version===step.fileVersion)
  const patch=state.patches.find(p=>p.id===step.patchId)
  if(!file||!patch)return null
  // Exact preimage check against CURRENT screenshot, not older stitched fragments.
  const rows=screen.observation.files.filter(f=>f.path===step.path&&f.confidence>=0.95&&f.startLine!==null)
  const observed=new Map<number,string>()
  for(const row of rows)row.lines.forEach((text,index)=>observed.set(row.startLine!+index,text))
  if(!patch.before.split('\n').every((line,index)=>observed.get(patch.startLine+index)===line))return null
  const count=step.operation==='insert-before'||step.operation==='insert-after'?1:Math.max(1,step.before.split('\n').length)
  const rects:Rect[]=[]
  for(let n=step.anchorLine;n<step.anchorLine+count;n++){
    const anchors=rows.flatMap(row=>row.lineRects??[]).filter(a=>a.line===n)
    if(anchors.length!==1)return null
    const rect=project(anchors[0].rect,surface);if(!rect)return null
    rects.push(rect)
  }
  const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y))
  return {sourceId:screen.sourceId,rect:{x,y,width:Math.max(...rects.map(r=>r.x+r.width))-x,height:Math.max(...rects.map(r=>r.y+r.height))-y}}
}
