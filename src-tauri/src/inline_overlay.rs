//! Explicitly selected IDE-window capture for spatial annotations. The main
//! webview becomes a borderless, click-through monitor-sized annotation surface.
//! Captures target the selected window, never our own composited overlay.
use serde::Serialize;
use std::sync::{Mutex, Arc, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use tauri::{Manager, Emitter, WebviewWindow};

#[derive(Clone)]
struct Lease { id:String, window_id:u32, pid:u32, created:Instant, busy:Arc<AtomicBool> }
struct Restore { position:tauri::PhysicalPosition<i32>, size:tauri::PhysicalSize<u32>, resizable:bool }
#[derive(Default)]
pub struct InlineState { lease:Mutex<Option<Lease>>, restore:Mutex<Option<Restore>>, heartbeat:Mutex<Option<Instant>>, epoch:AtomicU64, active_geometry:Mutex<Option<Geometry>> }
#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Geometry { x:i32,y:i32,width:u32,height:u32,monitor_x:i32,monitor_y:i32,monitor_width:u32,monitor_height:u32,scale:f64 }
#[derive(Serialize)]
pub struct Target { id:u32, title:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct WindowFrame { geometry:Geometry, focused:bool, width:u32,height:u32,pixels:Vec<u8>,image:Option<Vec<u8>> }
fn lease(state:&InlineState,id:&str)->Result<Lease,String>{crate::lock(&state.lease).as_ref().filter(|s|s.id==id&&s.created.elapsed()<Duration::from_secs(90*60)).cloned().ok_or("IDE capture ended or expired".into())}
#[tauri::command]
pub async fn inline_targets(window:WebviewWindow)->Result<Vec<Target>,String>{
 crate::coach_capture::trusted(&window)?;
 crate::coach_capture::request_permission()?;
 tauri::async_runtime::spawn_blocking(targets).await.map_err(|_|"Window discovery interrupted".to_string())?
}
#[tauri::command]
pub async fn inline_start(window:WebviewWindow,state:tauri::State<'_,InlineState>,window_id:u32,approved:bool)->Result<String,String>{
 crate::coach_capture::trusted(&window)?;
 if !approved||!window.is_visible().unwrap_or(false){return Err("Show the app and approve the selected IDE window".into())}
 let id=uuid::Uuid::new_v4().to_string();
 state.epoch.fetch_add(1,Ordering::SeqCst);
 *crate::lock(&state.lease)=Some(Lease{id:id.clone(),window_id,pid:0,created:Instant::now(),busy:Arc::new(AtomicBool::new(false))});
 let checked=tauri::async_runtime::spawn_blocking(move||target_pid(window_id)).await.map_err(|_|"Window validation interrupted".to_string()).and_then(|r|r);
 let mut guard=crate::lock(&state.lease);
 let selected=guard.as_mut().filter(|s|s.id==id).ok_or("IDE selection was superseded")?;
 match checked {Ok(pid)=>selected.pid=pid,Err(error)=>{guard.take();return Err(error)}}

 Ok(id)
}
struct Permit(Arc<AtomicBool>);
impl Drop for Permit {fn drop(&mut self){self.0.store(false,Ordering::Release)}}
#[tauri::command]
pub async fn inline_frame(window:WebviewWindow,state:tauri::State<'_,InlineState>,lease_id:String,full:bool)->Result<WindowFrame,String>{
 crate::coach_capture::trusted(&window)?;
 let selected=lease(&state,&lease_id)?;
 if selected.busy.swap(true,Ordering::AcqRel){return Err("IDE capture already running".into())}
 let permit=Permit(selected.busy.clone());
 let output=tauri::async_runtime::spawn_blocking(move||{let _p=permit;frame(&selected,full)}).await.map_err(|_|"IDE capture worker failed".to_string())??;
 lease(&state,&lease_id)?;
 if let Some(active)=crate::lock(&state.active_geometry).as_ref(){let g=&output.geometry;if active.monitor_x!=g.monitor_x||active.monitor_y!=g.monitor_y||active.monitor_width!=g.monitor_width||active.monitor_height!=g.monitor_height||active.scale!=g.scale{return Err("IDE moved between monitors or display scaling changed. Restore the workspace and select it again.".into())}}
 *crate::lock(&state.heartbeat)=Some(Instant::now());
 Ok(output)
}
#[tauri::command]
pub async fn inline_enter(window:WebviewWindow,app:tauri::AppHandle,lease_id:String)->Result<(),String>{
 crate::coach_capture::trusted(&window)?;
 let selected=lease(&app.state::<InlineState>(),&lease_id)?;
 let geometry=tauri::async_runtime::spawn_blocking(move||geometry_for(&selected)).await.map_err(|_|"Geometry check failed".to_string())??;
 let (tx,rx)=std::sync::mpsc::channel();let handle=app.clone();
 app.run_on_main_thread(move||{let result=lease(&handle.state::<InlineState>(),&lease_id).and_then(|_|enter(&handle,geometry));let _=tx.send(result);}).map_err(|e|e.to_string())?;
 tauri::async_runtime::spawn_blocking(move||rx.recv().map_err(|_|"Overlay entry interrupted".to_string())?).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn inline_exit(window:WebviewWindow,app:tauri::AppHandle)->Result<(),String>{
 crate::coach_capture::trusted(&window)?;
 let handle=app.clone();let(tx,rx)=std::sync::mpsc::channel();
 app.run_on_main_thread(move||{let _=tx.send(exit(&handle));}).map_err(|e|e.to_string())?;
 tauri::async_runtime::spawn_blocking(move||rx.recv().map_err(|_|"Overlay recovery interrupted".to_string())?).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn inline_stop(window:WebviewWindow,app:tauri::AppHandle,lease_id:String)->Result<(),String>{
 crate::coach_capture::trusted(&window)?;
 {
   let state=app.state::<InlineState>();let mut s=crate::lock(&state.lease);
   if s.as_ref().is_some_and(|s|s.id==lease_id){state.epoch.fetch_add(1,Ordering::SeqCst);s.take();}else{return Ok(())}
 }
 inline_exit(window,app).await
}
#[tauri::command]
pub fn inline_active(window:WebviewWindow,app:tauri::AppHandle)->Result<bool,String>{crate::coach_capture::trusted(&window)?;Ok(active(&app))}
pub fn active(app:&tauri::AppHandle)->bool {app.try_state::<InlineState>().is_some_and(|s|crate::lock(&s.restore).is_some())}
#[cfg(desktop)]
fn enter(app:&tauri::AppHandle,g:Geometry)->Result<(),String>{
 let state=app.state::<InlineState>();if active(app){return Ok(())}
 let win=app.get_webview_window("main").ok_or("Main window unavailable")?;
 if win.is_fullscreen().unwrap_or(true)||win.is_maximized().unwrap_or(true){return Err("Restore the app to a normal window before entering Inline Coach".into())}
 let saved=Restore{position:win.outer_position().map_err(|e|e.to_string())?,size:win.inner_size().map_err(|e|e.to_string())?,resizable:win.is_resizable().map_err(|e|e.to_string())?};
 *crate::lock(&state.restore)=Some(saved);
 let result=(||{
   win.set_resizable(false).map_err(|e|e.to_string())?;
   #[cfg(target_os="macos")]
   {win.set_position(tauri::LogicalPosition::new(g.monitor_x as f64,g.monitor_y as f64)).map_err(|e|e.to_string())?;win.set_size(tauri::LogicalSize::new(g.monitor_width as f64,g.monitor_height as f64)).map_err(|e|e.to_string())?;}
   #[cfg(not(target_os="macos"))]
   {win.set_position(tauri::PhysicalPosition::new(g.monitor_x,g.monitor_y)).map_err(|e|e.to_string())?;win.set_size(tauri::PhysicalSize::new(g.monitor_width,g.monitor_height)).map_err(|e|e.to_string())?;}
   #[cfg(target_os="windows")]
   window_vibrancy::clear_acrylic(&win).map_err(|e|e.to_string())?;
   crate::apply_lock(app,Some(true))?;
   *crate::lock(&state.active_geometry)=Some(g.clone());
   *crate::lock(&state.heartbeat)=Some(Instant::now());
   Ok::<(),String>(())
 })();
 if result.is_err(){let _=exit(app);}else{let _=app.emit_to("main","inline-mode-changed",true);}
 result
}
#[cfg(not(desktop))]
fn enter(_: &tauri::AppHandle,_:Geometry)->Result<(),String>{Err("Inline Coach requires desktop".into())}
pub fn exit(app:&tauri::AppHandle)->Result<(),String>{
 let Some(state)=app.try_state::<InlineState>() else{return Ok(())};
 crate::lock(&state.active_geometry).take();
 let saved=crate::lock(&state.restore).take();
 if let Some(saved)=saved {
   let pointer=crate::apply_lock(app,Some(false));
   let mut error=pointer.err();
   if let Some(win)=app.get_webview_window("main"){
     for result in [win.set_position(saved.position),win.set_size(saved.size),win.set_resizable(saved.resizable)]{if let Err(e)=result{error=Some(e.to_string())}}
     #[cfg(target_os="windows")]
     let _=window_vibrancy::apply_acrylic(&win,Some((18,18,26,200)));
   }
   let _=app.emit_to("main","inline-mode-changed",false);
   if let Some(e)=error{return Err(e)}
 }
 Ok(())
}
pub fn stop_all(app:&tauri::AppHandle){if let Some(s)=app.try_state::<InlineState>(){s.epoch.fetch_add(1,Ordering::SeqCst);crate::lock(&s.lease).take();}let handle=app.clone();let _=app.run_on_main_thread(move||{let _=exit(&handle);});}
pub fn watchdog(app:&tauri::AppHandle){
 let handle=app.clone();std::thread::spawn(move||loop{
   std::thread::sleep(Duration::from_secs(1));
   if active(&handle) && handle.state::<InlineState>().heartbeat.lock().ok().and_then(|s|*s).is_none_or(|t|t.elapsed()>Duration::from_secs(3)){
     let h=handle.clone();let _=handle.run_on_main_thread(move||{let _=exit(&h);});
   }
 });
}
#[cfg(any(target_os="macos",target_os="windows"))]
fn targets()->Result<Vec<Target>,String>{
 Ok(xcap::Window::all().map_err(|_|"Window discovery failed")?.into_iter().filter(|w|w.pid().ok()!=Some(std::process::id())&&!w.is_minimized().unwrap_or(true)).filter_map(|w|{Some(Target{id:w.id().ok()?,title:format!("{} — {}",w.app_name().ok()?,w.title().ok()?).chars().take(200).collect()})}).take(100).collect())
}
#[cfg(any(target_os="macos",target_os="windows"))]
fn target_pid(id:u32)->Result<u32,String>{let w=xcap::Window::all().map_err(|_|"Window discovery failed")?.into_iter().find(|w|w.id().ok()==Some(id)&&w.pid().ok()!=Some(std::process::id())).ok_or("Select another application's IDE window")?;w.pid().map_err(|_|"Window identity unavailable".into())}
#[cfg(any(target_os="macos",target_os="windows"))]
fn selected(s:&Lease)->Result<xcap::Window,String>{xcap::Window::all().map_err(|_|"Window discovery failed")?.into_iter().find(|w|w.id().ok()==Some(s.window_id)&&w.pid().ok()==Some(s.pid)&&!w.is_minimized().unwrap_or(true)).ok_or("Selected IDE window closed or minimized".into())}
#[cfg(any(target_os="macos",target_os="windows"))]
fn geometry(w:&xcap::Window)->Result<Geometry,String>{
 let m=w.current_monitor().map_err(|_|"Monitor unavailable")?;
 let value=(||->Result<Geometry,xcap::XCapError>{Ok(Geometry{x:w.x()?,y:w.y()?,width:w.width()?,height:w.height()?,monitor_x:m.x()?,monitor_y:m.y()?,monitor_width:m.width()?,monitor_height:m.height()?,scale:m.scale_factor()? as f64})})();
 let g=value.map_err(|_|"Window bounds unavailable")?;
 if g.width<200||g.height<150||!g.scale.is_finite()||g.scale<0.5||g.scale>4.0||g.x<g.monitor_x||g.y<g.monitor_y||i64::from(g.x)+i64::from(g.width)>i64::from(g.monitor_x)+i64::from(g.monitor_width)||i64::from(g.y)+i64::from(g.height)>i64::from(g.monitor_y)+i64::from(g.monitor_height){return Err("Keep the entire IDE window on one display before locating edits".into())}
 Ok(g)
}
#[cfg(any(target_os="macos",target_os="windows"))]
fn geometry_for(s:&Lease)->Result<Geometry,String>{geometry(&selected(s)?)}
#[cfg(any(target_os="macos",target_os="windows"))]
fn frame(s:&Lease,full:bool)->Result<WindowFrame,String>{
 let w=selected(s)?;let before=geometry(&w)?;
 let mut focused=w.is_focused().unwrap_or(false);
 #[cfg(target_os="macos")]
 {focused=focused && xcap::Window::all().ok().and_then(|list|list.into_iter().find(|win|win.pid().ok()==Some(s.pid)&&!win.is_minimized().unwrap_or(true))).and_then(|win|win.id().ok())==Some(s.window_id);}
 let pixels=w.capture_image().map_err(|_|"Selected-window capture failed. Check permissions; full-display fallback is intentionally disabled.")?;
 if pixels.width()>16000||pixels.height()>16000||u64::from(pixels.width())*u64::from(pixels.height())>50_000_000{return Err("IDE image exceeds capture budget".into())}
 let current=geometry(&selected(s)?)?;
 if before!=current{return Err("IDE moved while capturing. Select the window again.".into())}
 let expected=before.width as f64/before.height as f64;
 if ((pixels.width() as f64/pixels.height() as f64)/expected-1.0).abs()>0.01{return Err("Captured IDE bounds do not match its visible window. Inline anchors disabled.".into())}
 let picture=image::DynamicImage::ImageRgba8(pixels);
 let gray=picture.resize(640,640,image::imageops::FilterType::Triangle).to_luma8();
 let jpeg=if full{let mut bytes=Vec::new();let scaled=picture.resize(2400,2400,image::imageops::FilterType::Triangle).to_rgb8();image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes,94).encode_image(&scaled).map_err(|_|"Image encoding failed")?;if bytes.len()>4_400_000{return Err("IDE screenshot exceeds size limit".into())}Some(bytes)}else{None};
 Ok(WindowFrame{geometry:current,focused,width:gray.width(),height:gray.height(),pixels:gray.into_raw().into_iter().map(|p|(p/8)*8).collect(),image:jpeg})
}
#[cfg(not(any(target_os="macos",target_os="windows")))]
fn targets()->Result<Vec<Target>,String>{Err("Selected-window capture requires Windows or macOS".into())}
#[cfg(not(any(target_os="macos",target_os="windows")))]
fn target_pid(_:u32)->Result<u32,String>{Err("Unsupported platform".into())}
#[cfg(not(any(target_os="macos",target_os="windows")))]
fn geometry_for(_:&Lease)->Result<Geometry,String>{Err("Unsupported platform".into())}
#[cfg(not(any(target_os="macos",target_os="windows")))]
fn frame(_:&Lease,_:bool)->Result<WindowFrame,String>{Err("Unsupported platform".into())}

#[cfg(test)]
mod tests {
 use super::*;
 fn seeded()->InlineState { let s=InlineState::default();*crate::lock(&s.lease)=Some(Lease{id:"one".into(),window_id:42,pid:10,created:Instant::now(),busy:Arc::new(AtomicBool::new(false))});s }
 #[test]fn wrong_window_lease_is_rejected(){assert!(lease(&seeded(),"other").is_err());}
 #[test]fn expired_window_lease_is_rejected(){let s=seeded();crate::lock(&s.lease).as_mut().unwrap().created=Instant::now()-Duration::from_secs(91*60);assert!(lease(&s,"one").is_err());}
 #[test]fn stop_does_not_retain_access(){let s=seeded();crate::lock(&s.lease).take();assert!(lease(&s,"one").is_err());}
 #[test]fn capture_permit_releases_on_error_scope(){let flag=Arc::new(AtomicBool::new(true));{let _p=Permit(flag.clone());}assert!(!flag.load(Ordering::SeqCst));}
}
