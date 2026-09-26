'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CoachState } from '@/lib/coach/types'
import type { ScreenStatus } from '@/lib/coach/screen'
import { currentSteps, locateStep, type EditStep } from '@/lib/coach/inline/steps'
import { placeCallout, type Rect } from '@/lib/coach/inline/geometry'
import { inlineActive, exitInline } from '@/lib/coach/inline/native'
import styles from './InlineCoach.module.css'
export function EditCallout({step,target,viewport,index,total}:{step:EditStep;target:Rect;viewport:{width:number;height:number};index:number;total:number}){
 const content=step.operation==='delete'?step.before:step.after
 const wrapped=content.split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/39)),0)
 if(wrapped>8)return <div className={styles.status}>Multi-line change in {step.path}:{step.anchorLine}. Restore the workspace for the complete patch; no truncated code is shown.</div>
 const placement=placeCallout(target,viewport,360,Math.max(228,157+wrapped*20))
 if(!placement)return <div className={styles.status}>Target visible; not enough space beside it. Widen the IDE or restore the workspace.</div>
 const box=placement.rect
 const x1=placement.side==='right'?target.x+target.width+4:placement.side==='left'?target.x-4:target.x+target.width/2
 const y1=placement.side==='above'?target.y-4:placement.side==='below'?target.y+target.height+4:target.y+target.height/2
 const x2=placement.side==='right'?box.x:placement.side==='left'?box.x+box.width:Math.max(box.x,Math.min(x1,box.x+box.width))
 const y2=placement.side==='above'?box.y+box.height:placement.side==='below'?box.y:Math.max(box.y,Math.min(y1,box.y+box.height))
 const operation={replace:'Replace this line',delete:'Remove highlighted code','insert-before':'Insert before this line','insert-after':'Insert after this line'}[step.operation]
 return <>
   <svg className={styles.connector} width={viewport.width} height={viewport.height} aria-hidden="true"><path d={`M ${x1} ${y1} L ${x2} ${y2}`} /></svg>
   <div data-testid="inline-highlight" className={styles.highlight} style={{left:target.x-3,top:target.y-2,width:target.width+6,height:target.height+4}} />
   <section aria-label="Inline edit suggestion" className={styles.callout} style={{left:box.x,top:box.y,width:box.width,height:box.height}}>
     <div className={styles.say}><span>SAY THIS · FOR THIS CHANGE</span><p>{step.say.length>180?`${step.say.slice(0,177)}…`:step.say}</p></div>
     <div className={styles.change}><div className={styles.label}>{operation}<span>{index+1} / {total}</span></div>
       <div className={styles.file}>{step.path}:{step.anchorLine}</div>
       <pre>{content}</pre>
     </div>
     <footer>Suggested, not applied · location estimate: confirm the highlighted code</footer>
   </section>
 </>
}
export function InlineCoach({state,capture,active,onExit}:{state:CoachState;capture:ScreenStatus;active:boolean;onExit:()=>void}){
 const [selection,setSelection]=useState({key:'',index:0}),[now,setNow]=useState(Date.now)
 const steps=currentSteps(state),key=steps.map(s=>s.id).join('|')
 const index=selection.key===key?Math.min(selection.index,Math.max(0,steps.length-1)):0,step=steps[index]
 useEffect(()=>{
   if(!active)return
   const timer=setInterval(()=>setNow(Date.now()),250)
   let alive=true,unlisten:(()=>void)|undefined
   void import('@tauri-apps/api/event').then(async({listen})=>{
     const off=await listen<number>('inline-step',e=>setSelection(previous=>({key,index:Math.max(0,Math.min((previous.key===key?previous.index:0)+(e.payload>0?1:-1),steps.length-1))})))
     if(alive)unlisten=off;else off()
   }).catch(()=>{})
   return()=>{alive=false;clearInterval(timer);unlisten?.()}
 },[active,steps.length,key])
 useEffect(()=>{
   if(!active)return
   document.documentElement.classList.add('lt-inline')
   let alive=true,reading=false
   const sync=async()=>{if(reading)return;reading=true;try{if(!await inlineActive()&&alive)onExit()}catch{if(alive){void exitInline().catch(()=>{});onExit()}}finally{reading=false}}
   const timer=setInterval(()=>void sync(),750)
   return()=>{alive=false;clearInterval(timer);document.documentElement.classList.remove('lt-inline');void exitInline().catch(()=>{})}
 },[active,onExit])
 if(!active||typeof document==='undefined')return null
 const surface=capture.surface??null
 // A fresh native viewport must match the actual overlay CSS viewport. Never
 // reuse another monitor's origin, DPI, browser zoom or resized geometry.
 const aligned=surface&&Math.abs(surface.viewport.width-window.innerWidth)<3&&Math.abs(surface.viewport.height-window.innerHeight)<3
 const target=step&&aligned&&capture.watching?locateStep(state,step,surface,capture.acceptedSurfaceKey??null,now):null
 const shortcut=/Mac/.test(navigator.platform)?'⌘⇧':'Ctrl+Shift+'
 return createPortal(<div data-inline-root className={styles.root} aria-label="Inline Coach annotation layer">
   {target&&step&&surface?<EditCallout step={step} target={target.rect} viewport={surface.viewport} index={index} total={steps.length}/>:<div className={styles.status}>{state.task.implementation==='hold'?'Explain first — implementation is on hold.':step?`Locate ${step.path}:${step.anchorLine} — waiting for a fresh, legible target.`:'Listening — the next grounded edit will appear beside its source.'}</div>}
   <div className={styles.recovery}>Inline Coach · clicks go to IDE · {shortcut}Alt+← / → edit · {shortcut}L restore workspace</div>
 </div>,document.body)
}
