'use client'
import { useCallback,useEffect,useState } from 'react' 
import { createPortal } from 'react-dom'
import { Eye,EyeOff,Lock,Unlock } from 'lucide-react'
import { NativeWindowControls } from '@/components/NativeWindowControls'
import { restoreOverlayLayout, type OverlayLayout } from './overlayLayout'
import { OverlayPanel,type OverlayRect } from './OverlayPanel'
import styles from './OverlayWorkspace.module.css'
import { getNativeOverlayLock, nativeDesktopAvailable, setNativeCaptureProtection, setNativeOverlayLock, setNativeOverlayVisible } from '@/lib/desktop/overlay'
type Layout=OverlayLayout
const MINIMAL:Layout={next:{x:16,y:16,width:300,height:110,opacity:78},say:{x:16,y:138,width:300,height:155,opacity:72},code:{x:328,y:16,width:420,height:360,opacity:78},writing:{x:16,y:305,width:300,height:150,opacity:72},transcript:{x:328,y:388,width:420,height:100,opacity:58}}
function initialLayout(): Layout {
 // A fresh desktop session starts readable; old compact coordinates cannot hide a panel.
 if (!nativeDesktopAvailable()) {
  try { return restoreOverlayLayout(localStorage.getItem('lt-overlay-layout-v2'), MINIMAL) } catch { return MINIMAL }
 }
 const width = Math.max(320, window.innerWidth - 48)
 const height = Math.max(420, window.innerHeight - 220)
 const narrow = width < 700
 const left = narrow ? width : Math.floor((width - 16) * .44)
 const right = narrow ? width : width - left - 16
 return {
  next:{x:0,y:0,width:left,height:150,opacity:94},
  say:{x:0,y:166,width:left,height:Math.max(160,height-340),opacity:94},
  writing:{x:0,y:Math.max(342,height-158),width:left,height:150,opacity:92},
  code:{x:narrow?0:left+16,y:narrow?height+16:0,width:right,height,opacity:94},
  transcript:{x:0,y:narrow?height*2+32:height+16,width:left,height:150,opacity:58},
 }
}
export function OverlayWorkspace({next,say,code,writing,transcript,status,controls}:{next:React.ReactNode;say:React.ReactNode;code:React.ReactNode;writing:React.ReactNode;transcript:React.ReactNode;status?:React.ReactNode;controls?:React.ReactNode}){
 const [layout,setLayout]=useState<Layout>(initialLayout),[locked,setLocked]=useState(false),[visible,setVisible]=useState(true),[showTranscript]=useState(false),[native]=useState(()=>nativeDesktopAvailable())
 const [desktopVersion,setDesktopVersion]=useState<string|null>(null)
 useEffect(()=>{if(!native)return;let alive=true;void import('@tauri-apps/api/app').then(api=>api.getVersion()).then(version=>{if(alive)setDesktopVersion(version)}).catch(()=>{});return()=>{alive=false}},[native])
 const [windowError,setWindowError]=useState<string|null>(null)
 useEffect(()=>{
  if(!native)return
  document.documentElement.classList.add('lt-overlay-mode')
  void setNativeCaptureProtection(true).catch(()=>setWindowError('Screen capture protection could not be enabled.'))
  let alive=true
  const sync=()=>void getNativeOverlayLock().then(value=>{if(alive)setLocked(value)}).catch(()=>{})
  sync();const timer=setInterval(sync,1500)
  return()=>{alive=false;clearInterval(timer);document.documentElement.classList.remove('lt-overlay-mode')}
 },[native])
 const update=useCallback((key:keyof Layout,next:OverlayRect)=>setLayout(prev=>{const value={...prev,[key]:next};try{localStorage.setItem('lt-overlay-layout-v2',JSON.stringify(value))}catch{}return value}),[])
 const opacity=Math.round((layout.next.opacity+layout.say.opacity+layout.code.opacity+layout.transcript.opacity)/4)
 if(!visible){const hidden=<div className={`${styles.hiddenBar} lt-overlay-root`}><button onClick={()=>setVisible(true)}><Eye size={13}/>Show overlays</button></div>;return native?createPortal(hidden,document.body):hidden}
 const workspace=<div className={`${styles.shell} lt-overlay-root`}>
  <div className={styles.toolbar} data-tauri-drag-region><span className={styles.liveDot}/><strong>Live</strong>{status}<span className={styles.spacer}/><label title="Panel background opacity; text remains fully opaque">Opacity <input aria-label="Overlay background transparency" type="range" min="20" max="96" value={opacity} onChange={e=>{const v=Number(e.target.value);setLayout(p=>{const n={next:{...p.next,opacity:v},say:{...p.say,opacity:v},code:{...p.code,opacity:v},writing:{...p.writing,opacity:v},transcript:{...p.transcript,opacity:Math.max(20,v-18)}};try{localStorage.setItem('lt-overlay-layout-v2',JSON.stringify(n))}catch{}return n})}}/><span>{opacity}%</span></label><button title={native?'Lock enables native click-through. Use the global hotkey or tray to unlock.':'Browser lock freezes panel geometry; click-through requires the desktop app.'} onClick={()=>{setWindowError(null);const next=!locked;if(native){void setNativeOverlayLock(next).then(()=>{setLocked(next);setWindowError(null)}).catch(error=>setWindowError(typeof error==='string'?error:'Click-through could not be changed. Use the menu bar icon to unlock.'))}else setLocked(next)}}>{locked?<><Lock size={13}/>{native?'Click-through · ⇧⌘U unlock':'Locked'}</>:<><Unlock size={13}/>Click-through off</>}</button><button onClick={()=>{if(native){void setNativeOverlayVisible(false).catch(()=>setWindowError('Could not hide the window. Use the tray or hide shortcut.'))}else setVisible(false)}}><EyeOff size={13}/>Hide</button></div>
  {native && <NativeWindowControls />}
  {windowError && <p role="alert" className={styles.windowError}>{windowError} <button onClick={()=>setWindowError(null)}>Dismiss</button></p>}
  {controls && <div className={styles.sessionControls} role="region" aria-label="Live interview options"><strong>Live interview</strong>{controls}{desktopVersion && <small>Desktop {desktopVersion}</small>}</div>}
  <div className={styles.workspaceBody}><div className={styles.canvas} data-locked={locked}>
   <OverlayPanel title="What to do next" rect={layout.next} onChange={n=>update('next',n)} locked={locked} accent="neutral">{next}</OverlayPanel>
   <OverlayPanel title="What to say" rect={layout.say} onChange={n=>update('say',n)} locked={locked} accent="say">{say}</OverlayPanel>
   <OverlayPanel title="What to write" rect={layout.code} onChange={n=>update('code',n)} locked={locked} accent="code">{code}</OverlayPanel>
   <OverlayPanel title="While writing" rect={layout.writing} onChange={n=>update('writing',n)} locked={locked} accent="say">{writing}</OverlayPanel>
   {showTranscript&&<OverlayPanel title="Latest question" rect={layout.transcript} onChange={n=>update('transcript',n)} locked={locked} accent="transcript">{transcript}</OverlayPanel>}
  </div>
  </div>
 </div>
 return native ? createPortal(workspace, document.body) : workspace
}
