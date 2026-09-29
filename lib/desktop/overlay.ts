export function nativeDesktopAvailable(){return typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window}
export async function setNativeOverlayLock(enabled:boolean):Promise<boolean>{if(!nativeDesktopAvailable())return false;const{invoke}=await import('@tauri-apps/api/core');await invoke('set_lock_mode',{enabled});return true}
export async function getNativeOverlayLock():Promise<boolean>{if(!nativeDesktopAvailable())return false;const{invoke}=await import('@tauri-apps/api/core');return Boolean(await invoke('get_lock_mode'))}
export async function setNativeCaptureProtection(enabled=true):Promise<boolean>{if(!nativeDesktopAvailable())return false;const{invoke}=await import('@tauri-apps/api/core');await invoke('set_content_protection',{enabled});return true}
