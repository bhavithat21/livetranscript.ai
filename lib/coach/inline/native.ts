import type { FrameSource } from '../screen'
import { hashText } from '../validation'
import type { SurfaceFrame } from './geometry'
export type InlineTarget = { id:number; title:string }
async function invoke<T>(name:string,args?:Record<string,unknown>):Promise<T>{return (await import('@tauri-apps/api/core')).invoke<T>(name,args)}
export const inlineTargets=()=>invoke<InlineTarget[]>('inline_targets')
export const exitInline=()=>invoke<void>('inline_exit')
export const inlineActive=()=>invoke<boolean>('inline_active')
type NativeFrame={geometry:{x:number;y:number;width:number;height:number;monitorX:number;monitorY:number;monitorWidth:number;monitorHeight:number;scale:number};focused:boolean;width:number;height:number;pixels:number[];image:number[]|null}
export type InlineFrameSource=FrameSource&{enter:()=>Promise<void>}
export async function inlineFrameSource(windowId:number):Promise<InlineFrameSource>{
 const leaseId=await invoke<string>('inline_start',{windowId,approved:true})
 let stopped=false,surface:SurfaceFrame|null=null,chain:Promise<unknown>=Promise.resolve()
 // Serialize explicit grabs against local samples; native also bounds concurrency.
 function read(full:boolean){
   const result=chain.then(async()=>{
     if(stopped)throw new Error('IDE source ended')
     const f=await invoke<NativeFrame>('inline_frame',{leaseId,full})
     if(stopped)throw new Error('IDE source ended')
     if(!Number.isSafeInteger(f.width)||!Number.isSafeInteger(f.height)||f.width<1||f.height<1||f.width>640||f.height>640||f.pixels.length!==f.width*f.height)throw new Error('Invalid IDE sample')
     const pixels=Uint8Array.from(f.pixels);let str=''
     for(let i=0;i<pixels.length;i+=8192)str+=String.fromCharCode(...pixels.subarray(i,i+8192))
     const g=f.geometry,unit=/Mac/.test(navigator.platform)?1:g.scale
     if(!Number.isFinite(unit)||unit<=0)throw new Error('Invalid display scale')
     const key=`${leaseId}:${JSON.stringify(g)}:${hashText(str)}`
     surface={key,sourceId:leaseId,sampledAt:Date.now(),focused:f.focused,viewport:{width:g.monitorWidth/unit,height:g.monitorHeight/unit},source:{x:(g.x-g.monitorX)/unit,y:(g.y-g.monitorY)/unit,width:g.width/unit,height:g.height/unit}}
     return {f,pixels,key}
   });chain=result.catch(()=>{});return result
 }
 return {
   surface:()=>surface,
   async signal(){const {f,pixels,key}=await read(false);return {width:f.width,height:f.height,pixels,fingerprint:key}},
   async image(){const {f}=await read(true);const bytes=f.image;if(!bytes||bytes.length>4_400_000||bytes[0]!==255||bytes[1]!==216)throw new Error('Invalid IDE screenshot');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));return `data:image/jpeg;base64,${btoa(binary)}`},
   async enter(){if(stopped)throw new Error('Select the IDE again');await invoke('inline_enter',{leaseId})},
   async stop(){if(!stopped){stopped=true;surface=null;await invoke('inline_stop',{leaseId}).catch(()=>{})}},
 }
}
