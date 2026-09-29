'use client'
import { useCallback,useEffect,useState } from 'react' 
import { createPortal } from 'react-dom'
import { Eye,EyeOff,Lock,Unlock,LayoutTemplate } from 'lucide-react'
import { OverlayPanel,type OverlayRect } from './OverlayPanel'
import styles from './OverlayWorkspace.module.css'
import { getNativeOverlayLock, nativeDesktopAvailable, setNativeCaptureProtection, setNativeOverlayLock, setNativeOverlayWindowSize } from '@/lib/desktop/overlay'
type Layout={say:OverlayRect;code:OverlayRect;transcript:OverlayRect}
const DEFAULT:Layout={say:{x:18,y:54,width:360,height:150,opacity:72},code:{x:392,y:54,width:470,height:360,opacity:78},transcript:{x:18,y:430,width:520,height:70,opacity:55}}
const MINIMAL:Layout={say:{x:650,y:30,width:390,height:180,opacity:82},code:{x:650,y:228,width:390,height:430,opacity:86},transcript:{x:28,y:590,width:600,height:68,opacity:45}}
export function OverlayWorkspace({say,code,transcript,status}:{say:React.ReactNode;code:React.ReactNode;transcript:React.ReactNode;status?:React.ReactNode}){
 const [layout,setLayout]=useState<Layout>(()=>{if(typeof window==='undefined')return DEFAULT;try{const raw=localStorage.getItem('lt-overlay-layout-v2');return raw?JSON.parse(raw):DEFAULT}catch{return DEFAULT}}),[locked,setLocked]=useState(false),[visible,setVisible]=useState(true),[showTranscript,setShowTranscript]=useState(false),[native]=useState(()=>nativeDesktopAvailable())
 useEffect(()=>{if(native){void setNativeOverlayWindowSize('small');document.documentElement.classList.add('lt-overlay-mode');void setNativeCaptureProtection(true);void getNativeOverlayLock().then(setLocked).catch(()=>{});return()=>document.documentElement.classList.remove('lt-overlay-mode')}},[native])
 const update=useCallback((key:keyof Layout,next:OverlayRect)=>setLayout(prev=>{const value={...prev,[key]:next};try{localStorage.setItem('lt-overlay-layout-v2',JSON.stringify(value))}catch{}return value}),[])
 const opacity=Math.round((layout.say.opacity+layout.code.opacity+layout.transcript.opacity)/3)
 if(!visible){const hidden=<div className={`${styles.hiddenBar} lt-overlay-root`}><button onClick={()=>setVisible(true)}><Eye size={13}/>Show overlays</button></div>;return native?createPortal(hidden,document.body):hidden}
 const workspace=<div className={`${styles.shell} lt-overlay-root`}>
  <div className={styles.toolbar}><span className={styles.liveDot}/><strong>Live</strong>{status}<span className={styles.spacer}/><label title="Panel background opacity; text remains fully opaque">Opacity <input aria-label="Overlay background transparency" type="range" min="20" max="96" value={opacity} onChange={e=>{const v=Number(e.target.value);setLayout(p=>{const n={say:{...p.say,opacity:v},code:{...p.code,opacity:v},transcript:{...p.transcript,opacity:Math.max(20,v-18)}};try{localStorage.setItem('lt-overlay-layout-v2',JSON.stringify(n))}catch{}return n})}}/><span>{opacity}%</span></label><button title={native?'Lock enables native click-through. Use the global hotkey or tray to unlock.':'Browser lock freezes panel geometry; click-through requires the desktop app.'} onClick={()=>{const next=!locked;if(native){void setNativeOverlayLock(next).then(()=>setLocked(next)).catch(()=>{})}else setLocked(next)}}>{locked?<><Lock size={13}/>{native?'Click-through · ⇧⌘Space unlock':'Locked'}</>:<><Unlock size={13}/>Move & resize</>}</button><button onClick={()=>setLayout(p=>({...MINIMAL,say:{...MINIMAL.say,opacity:p.say.opacity},code:{...MINIMAL.code,opacity:p.code.opacity},transcript:{...MINIMAL.transcript,opacity:p.transcript.opacity}}))}><LayoutTemplate size={13}/>Compact</button><button onClick={()=>setShowTranscript(v=>!v)}>{showTranscript?'Hide question':'Question'}</button>{native&&<><button aria-label="Smaller overlay window" onClick={()=>void setNativeOverlayWindowSize('small')}>−</button><button aria-label="Medium overlay window" onClick={()=>void setNativeOverlayWindowSize('medium')}>□</button><button aria-label="Larger overlay window" onClick={()=>void setNativeOverlayWindowSize('large')}>+</button></>}<button onClick={()=>setVisible(false)}><EyeOff size={13}/>Hide</button></div>
  <div className={styles.canvas} data-locked={locked}>
   <OverlayPanel title="What to say" rect={layout.say} onChange={n=>update('say',n)} locked={locked} accent="say">{say}</OverlayPanel>
   <OverlayPanel title="Code / solution" rect={layout.code} onChange={n=>update('code',n)} locked={locked} accent="code">{code}</OverlayPanel>
   {showTranscript&&<OverlayPanel title="Latest question" rect={layout.transcript} onChange={n=>update('transcript',n)} locked={locked} accent="transcript">{transcript}</OverlayPanel>}
  </div>
 </div>
 return native ? createPortal(workspace, document.body) : workspace
}
