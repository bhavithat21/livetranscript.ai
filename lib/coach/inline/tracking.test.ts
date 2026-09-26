import { describe, it, expect, vi, afterEach } from 'vitest'
import { inlineFixture } from '../../../qa/inline-coach/fixture'
import { anchorKey, buildVisualSeed, trackedRect, parseTrackingReceipt, TrackingMetrics, type VisualSeed, type TrackingReceipt } from './tracking'
import { hashText, parseObservation } from '../validation'
import {parseScreenObservation} from '../../repo/screenEvidence'
import {buildContext} from '../context'
import {parseTrackingRegions} from './geometry'
import { ScreenObserver, type FrameSource } from '../screen'

const result = (id='a'): TrackingReceipt => ({ anchorId:id,status:'tracking',rect:{x:.1,y:.2,width:.3,height:.03},dx:0,dy:-20,processingMs:3,probes:2000,semanticDirty:false })
function fixture() {
 const f=inlineFixture();f.state.lastScreen!.observation.files[0].trackingRegions={editor:{x:.05,y:.2,width:.8,height:.65},identity:{x:.05,y:.03,width:.8,height:.05},watch:[]};f.surface.captureId='capture-1';f.surface.observationKey=hashText(JSON.stringify(f.state.lastScreen!.observation));return f
}
describe('screenshot-only anchor bridge',()=>{
 it('requires explicit screenshot region evidence rather than inferring a header from a clipped row',()=>{const f=fixture();delete f.state.lastScreen!.observation.files[0].trackingRegions;f.surface.observationKey=hashText(JSON.stringify(f.state.lastScreen!.observation));expect(buildVisualSeed(f.state,f.step,f.surface)).toBeNull()})
 it('validates region bounds and separation at both extraction boundaries',()=>{const f=fixture();const o=f.state.lastScreen!.observation;expect(parseObservation(parseScreenObservation(o)).files[0].trackingRegions?.watch).toEqual([]);o.files[0].trackingRegions!.identity=o.files[0].trackingRegions!.editor;expect(()=>parseScreenObservation(o)).toThrow();expect(()=>parseObservation(o)).toThrow()})
 it('rejects unbounded or overlapping watched output and malformed geometry',()=>{const r=fixture().state.lastScreen!.observation.files[0].trackingRegions!;for(const bad of [{...r,watch:[r.editor]},{...r,watch:Array(4).fill(r.identity)},{...r,identity:{x:NaN,y:0,width:.2,height:.1}}])expect(()=>parseTrackingRegions(bad)).toThrow()})
 it('keeps region metadata out of the reasoning context',()=>{const f=fixture();f.state.files[0].fragments[0].trackingRegions=f.state.lastScreen!.observation.files[0].trackingRegions;expect(JSON.stringify(buildContext(f.state))).not.toContain('trackingRegions')})

 it('seeds only an exact observed preimage tied to its retained screenshot',()=>{const f=fixture(),seed=buildVisualSeed(f.state,f.step,f.surface);expect(seed).not.toBeNull();expect(seed?.captureId).toBe('capture-1')})
 it('does not bind a new interpretation to old image pixels',()=>{const f=fixture();f.surface.observationKey='different';expect(buildVisualSeed(f.state,f.step,f.surface)).toBeNull()})
 it('requires enough surrounding observed rows',()=>{const f=fixture();f.state.lastScreen!.observation.files[0].lineRects!.splice(1);f.surface.observationKey=hashText(JSON.stringify(f.state.lastScreen!.observation));expect(buildVisualSeed(f.state,f.step,f.surface)).toBeNull()})
 it('follows a verified normalized position even after the whole-frame hash changes',()=>{const f=fixture();f.surface.key='scrolled';f.surface.tracking=result(anchorKey(f.state,f.step,f.surface.sourceId));expect(trackedRect(f.state,f.step,f.surface,2100)).toEqual(f.surface.tracking.rect)})
 for(const cause of ['source-changed','dirty','stale','different-step','new-question','new-task','new-code','unfocused','ambiguous','edited','lost','paused'])it(`withholds pointer for ${cause}`,()=>{
   const f=fixture();f.surface.tracking=result(anchorKey(f.state,f.step,f.surface.sourceId));let now=2100
   if(cause==='source-changed')f.surface.sourceId='new-window'
   if(cause==='dirty')f.surface.tracking.semanticDirty=true
   if(cause==='stale')now=2500
   if(cause==='different-step')f.surface.tracking.anchorId='other'
   if(cause==='new-question')f.state.question!.id='new'
   if(cause==='new-task')f.state.task.version++
   if(cause==='new-code')f.state.codeVersion++
   if(cause==='unfocused')f.surface.focused=false
   if(['ambiguous','edited','lost'].includes(cause))f.surface.tracking.status=cause
   if(cause==='paused')f.state.status='paused'
   expect(trackedRect(f.state,f.step,f.surface,now)).toBeNull()
 })
 it('validates every coordinate and diagnostic value across native IPC',()=>{
   expect(parseTrackingReceipt(result())).not.toBeNull()
   for(const raw of [{...result(),rect:{x:NaN,y:0,width:.2,height:.02}},{...result(),processingMs:-1},{...result(),rect:null},{...result(),status:'verified-correct'},{...result(),semanticDirty:'false'}])expect(parseTrackingReceipt(raw)).toBeNull()
 })
 it('does not turn diagnostics into an accuracy claim and bounds timing samples',()=>{const m=new TrackingMetrics(),f=fixture();f.surface.tracking=result();for(let i=0;i<500;i++)m.record({...f.surface,sampledAt:3000+i*50},20);const out=m.report();expect(out.frames).toBe(500);expect(out.kernel.samples).toBe(240);expect(out.correctAttachmentRate).toBeNull();expect(out.sourceLocalizationError).toBeNull()})
})
const image='data:image/jpeg;base64,/9j/AA=='
function observerFixture() {
 const f=fixture(); let rec:TrackingReceipt|null=null, tick=0, fingerprint='base'
 const source:FrameSource={
  signal:vi.fn(async()=>{tick++;f.surface={...f.surface,sampledAt:Date.now(),tracking:rec,key:fingerprint};return {width:8,height:8,pixels:new Uint8Array(64).fill(100),fingerprint}}),
  image:vi.fn(async()=>image),stop:vi.fn(),surface:()=>f.surface,intervalMs:()=>50,track:vi.fn(async()=>{}),
 }
 const transport=vi.fn(async()=>({files:[],visiblePaths:[],requirements:[],terminal:''})), observed=vi.fn()
 const observer=new ScreenObserver(observed,transport)
 const seed={anchorId:'a',captureId:'first',target:result().rect!,context:result().rect!,search:result().rect!,identity:result().rect!,watch:[]} satisfies VisualSeed
 return {observer,source,transport,observed,seed,set:(r:TrackingReceipt|null,key='moved')=>{rec=r;fingerprint=key},ticks:()=>tick}
}
afterEach(()=>vi.useRealTimers())
describe('independent visual and semantic scheduling',()=>{
 it('reuses 60+ moving local frames without paid interpretation calls',async()=>{
   vi.useFakeTimers();const f=observerFixture();await f.observer.attach(f.source,'native');await f.observer.setTrackingSeed(f.seed);f.set(result());f.observer.watch(true);await vi.advanceTimersByTimeAsync(3100);expect(f.ticks()).toBeGreaterThan(60);expect(f.transport).not.toHaveBeenCalled();expect(f.observer.trackingReport().locallyReusedFrames).toBeGreaterThan(60);await f.observer.stop()
 })
 it('forces fresh semantic evidence on a new question even if pixels are identical',async()=>{
   vi.useFakeTimers();const f=observerFixture();await f.observer.attach(f.source,'native');await f.observer.setTrackingSeed(f.seed);f.set(result());f.observer.watch(true);await vi.advanceTimersByTimeAsync(200);f.observer.requestRefresh();await vi.advanceTimersByTimeAsync(800);expect(f.transport).toHaveBeenCalledTimes(1);await f.observer.stop()
 })
 it('a native small-edit detection triggers reread even if the 640px thumbnail hash stays unchanged',async()=>{
   vi.useFakeTimers();const f=observerFixture();await f.observer.attach(f.source,'native');f.observer.watch(true);await vi.advanceTimersByTimeAsync(700);expect(f.transport).toHaveBeenCalledTimes(1);await f.observer.setTrackingSeed(f.seed);f.set({...result(),status:'edited',rect:null},'base');await vi.advanceTimersByTimeAsync(700);expect(f.transport).toHaveBeenCalledTimes(2);await f.observer.stop()
 })
 it('keeps background evidence invalidation pending instead of redisplaying old advice a frame later',async()=>{
   vi.useFakeTimers();const f=observerFixture();await f.observer.attach(f.source,'native');await f.observer.setTrackingSeed(f.seed);f.set({...result(),semanticDirty:true});f.observer.watch(true);await vi.advanceTimersByTimeAsync(60);expect(f.observer.getSnapshot().trackingNeedsReview).toBe(true);f.set(result());await vi.advanceTimersByTimeAsync(150);expect(f.observer.getSnapshot().trackingNeedsReview).toBe(true);await f.observer.stop()
 })
 it('releases a hung screenshot transport on its deadline',async()=>{
   vi.useFakeTimers();const observer=new ScreenObserver(vi.fn(),()=>new Promise(()=>{}));const p=observer.capture(image);await vi.advanceTimersByTimeAsync(18001);expect(await p).toBe(false);expect(observer.getSnapshot().reading).toBe(false);observer.dispose()
 })
 it('only arms each source/capture/step once and ignores stale arming errors',async()=>{
   const f=observerFixture();await f.observer.attach(f.source,'native');await f.observer.setTrackingSeed(f.seed);await f.observer.setTrackingSeed(f.seed);expect(f.source.track).toHaveBeenCalledTimes(1);await f.observer.setTrackingSeed(null);expect(f.source.track).toHaveBeenCalledTimes(2);await f.observer.stop()
 })
 it('coalesces user recaptures while the source image is still loading',async()=>{
   const f=observerFixture();let resolve:(value:string)=>void=()=>{};f.source.image=vi.fn(()=>new Promise<string>(r=>resolve=r));await f.observer.attach(f.source,'native');const a=f.observer.captureNow();expect(await f.observer.captureNow()).toBe(false);resolve(image);expect(await a).toBe(true);expect(f.source.image).toHaveBeenCalledTimes(1);await f.observer.stop()
 })
})
