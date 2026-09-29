'use client'
import { useCallback,useEffect,useState } from 'react'
import { Eye,EyeOff,Lock,Unlock,LayoutTemplate } from 'lucide-react'
import { OverlayPanel,type OverlayRect } from './OverlayPanel'
import styles from './OverlayWorkspace.module.css'
import { getNativeOverlayLock, nativeDesktopAvailable, setNativeCaptureProtection, setNativeOverlayLock } from '@/lib/desktop/overlay'
type Layout={say:OverlayRect;code:OverlayRect;transcript:OverlayRect}
const DEFAULT:Layout={say:{x:28,y:28,width:430,height:190,opacity:78},code:{x:480,y:28,width:560,height:500,opacity:84},transcript:{x:28,y:548,width:1012,height:120,opacity:58}}
const MINIMAL:Layout={say:{x:650,y:30,width:390,height:180,opacity:82},code:{x:650,y:228,width:390,height:430,opacity:86},transcript:{x:28,y:590,width:600,height:68,opacity:45}}
export function OverlayWorkspace({say,code,transcript,status}:{say:React.ReactNode;code:React.ReactNode;transcript:React.ReactNode;status?:React.ReactNode}){
 const [layout,setLayout]=useState<Layout>(()=>{if(typeof window==='undefined')return DEFAULT;try{const raw=localStorage.getItem('lt-overlay-layout-v1');return raw?JSON.parse(raw):DEFAULT}catch{return DEFAULT}}),[locked,setLocked]=useState(false),[visible,setVisible]=useState(true),[native]=useState(()=>nativeDesktopAvailable())
 useEffect(()=>{if(native){void setNativeCaptureProtection(true);void getNativeOverlayLock().then(setLocked).catch(()=>{})}},[native])
 const update=useCallback((key:keyof Layout,next:OverlayRect)=>setLayout(prev=>{const value={...prev,[key]:next};try{localStorage.setItem('lt-overlay-layout-v1',JSON.stringify(value))}catch{}return value}),[])
 const opacity=Math.round((layout.say.opacity+layout.code.opacity+layout.transcript.opacity)/3)
 if(!visible)return <div className={styles.hiddenBar}><button onClick={()=>setVisible(true)}><Eye size={13}/>Show overlays</button></div>
 return <div className={styles.shell}>
  <div className={styles.toolbar}><span className={styles.liveDot}/><strong>Overlay workspace</strong>{status}<span className={styles.spacer}/><label>Background <input aria-label="Overlay background transparency" type="range" min="20" max="96" value={opacity} onChange={e=>{const v=Number(e.target.value);setLayout(p=>{const n={say:{...p.say,opacity:v},code:{...p.code,opacity:v},transcript:{...p.transcript,opacity:Math.max(20,v-18)}};try{localStorage.setItem('lt-overlay-layout-v1',JSON.stringify(n))}catch{}return n})}}/><span>{opacity}%</span></label><button title={native?'Lock enables native click-through. Use the global hotkey or tray to unlock.':'Browser lock freezes panel geometry; click-through requires the desktop app.'} onClick={()=>{const next=!locked;if(native){void setNativeOverlayLock(next).then(()=>setLocked(next)).catch(()=>{})}else setLocked(next)}}>{locked?<><Lock size={13}/>{native?'Click-through':'Locked'}</>:<><Unlock size={13}/>Move & resize</>}</button><button onClick={()=>setLayout(p=>({...MINIMAL,say:{...MINIMAL.say,opacity:p.say.opacity},code:{...MINIMAL.code,opacity:p.code.opacity},transcript:{...MINIMAL.transcript,opacity:p.transcript.opacity}}))}><LayoutTemplate size={13}/>Compact</button><button onClick={()=>setLayout(DEFAULT)}><LayoutTemplate size={13}/>Full</button><button onClick={()=>setVisible(false)}><EyeOff size={13}/>Hide</button></div>
  <div className={styles.canvas} data-locked={locked}>
   <OverlayPanel title="What to say" rect={layout.say} onChange={n=>update('say',n)} locked={locked} accent="say">{say}</OverlayPanel>
   <OverlayPanel title="Code / solution" rect={layout.code} onChange={n=>update('code',n)} locked={locked} accent="code">{code}</OverlayPanel>
   <OverlayPanel title="Latest question" rect={layout.transcript} onChange={n=>update('transcript',n)} locked={locked} accent="transcript">{transcript}</OverlayPanel>
  </div>
 </div>
}
