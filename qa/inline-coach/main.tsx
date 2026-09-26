import {createRoot} from 'react-dom/client'
import {useEffect,useState} from 'react'
import {InlineCoach} from '../../components/coach/inline/InlineCoach'
import {inlineFixture} from './fixture'
import '../../app/globals.css'
import './qa.css'
function App(){
 const [fixture,setFixture]=useState(inlineFixture),[active,setActive]=useState(true),[accepted,setAccepted]=useState('frame1')
 const refresh=()=>{
   const f=inlineFixture(),e=document.getElementById('code10')!.getBoundingClientRect()
   f.surface.viewport={width:innerWidth,height:innerHeight};f.surface.source={x:0,y:0,width:innerWidth,height:innerHeight};f.surface.sampledAt=Date.now()
   f.state.lastScreen!.observation.files[0].lineRects![0].rect={x:e.x/innerWidth,y:e.y/innerHeight,width:e.width/innerWidth,height:e.height/innerHeight}
   setAccepted('frame1');setFixture(f)
 }
 useEffect(()=>{
   const t=setTimeout(refresh,100)
   const interval=setInterval(()=>setFixture(f=>({...f,surface:{...f.surface,sampledAt:Date.now()}})),400)
   window.addEventListener('resize',refresh)
   Object.assign(window,{__inlineQA:{reset:refresh,change:(reason:string)=>{
     if(reason==='scroll')setAccepted('new-frame')
     if(reason==='wrong-file')setFixture(f=>({...f,state:{...f.state,lastScreen:{...f.state.lastScreen!,observation:{...f.state.lastScreen!.observation,files:[]}}}}))
     if(reason==='lost-focus')setFixture(f=>({...f,surface:{...f.surface,focused:false}}))
     if(reason==='hold')setFixture(f=>({...f,state:{...f.state,task:{...f.state.task,implementation:'hold'}}}))
     if(reason==='viewport')setFixture(f=>({...f,surface:{...f.surface,viewport:{width:800,height:600}}}))
   }}})
   return()=>{clearTimeout(t);clearInterval(interval);window.removeEventListener('resize',refresh)}
 },[])
 return <InlineCoach state={fixture.state} capture={{sharing:true,watching:true,reading:false,captures:1,localSamples:1,error:null,source:'native',surface:fixture.surface,acceptedSurfaceKey:accepted}} active={active} onExit={()=>setActive(false)}/>
}
Object.assign(window,{__TAURI_INTERNALS__:{}})
createRoot(document.getElementById('root')!).render(<App/> )
