'use client'
import { useEffect,useRef,useState,type CSSProperties, type ReactNode } from 'react'
import { Grip, Lock, Unlock, Minus, Maximize2 } from 'lucide-react'
import styles from './OverlayPanel.module.css'
export type OverlayRect={x:number;y:number;width:number;height:number;opacity:number}
export function OverlayPanel({title,rect,onChange,locked,children,accent='neutral'}:{title:string;rect:OverlayRect;onChange:(next:OverlayRect)=>void;locked:boolean;children:ReactNode;accent?:'neutral'|'say'|'code'|'transcript'}){
 const ref=useRef<HTMLElement>(null),drag=useRef<{x:number;y:number;left:number;top:number}|null>(null),[collapsed,setCollapsed]=useState(false)
 useEffect(()=>{const el=ref.current;if(!el)return;const ro=new ResizeObserver(([entry])=>{if(!entry||locked)return;if(collapsed)return;const width=el.offsetWidth,height=el.offsetHeight;if(Math.abs(width-rect.width)>2||Math.abs(height-rect.height)>2)onChange({...rect,width:Math.round(width),height:Math.round(height)})});ro.observe(el);return()=>ro.disconnect()},[locked,onChange,rect,collapsed])
 function down(e:React.PointerEvent){if(locked)return;drag.current={x:e.clientX,y:e.clientY,left:rect.x,top:rect.y};e.currentTarget.setPointerCapture(e.pointerId)}
 function move(e:React.PointerEvent){if(!drag.current||locked)return;onChange({...rect,x:Math.max(0,drag.current.left+e.clientX-drag.current.x),y:Math.max(0,drag.current.top+e.clientY-drag.current.y)})}
 function up(){drag.current=null}
 const style={'--panel-x':`${rect.x}px`,'--panel-y':`${rect.y}px`,'--panel-w':`${rect.width}px`,'--panel-h':collapsed?'auto':`${rect.height}px`,'--panel-alpha':String(rect.opacity/100)} as CSSProperties
 return <section ref={ref} className={styles.panel} data-accent={accent} data-locked={locked} style={style} aria-label={title}>
  <header className={styles.header} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}><span className={styles.grip}><Grip size={13}/></span><strong>{title}</strong><span className={styles.state}>{locked?<Lock size={11}/>:<Unlock size={11}/>}</span><button type="button" aria-label={collapsed?`Expand ${title}`:`Collapse ${title}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<Maximize2 size={12}/>:<Minus size={12}/>}</button></header>
  {!collapsed&&<div className={styles.body}>{children}</div>}
 </section>
}
