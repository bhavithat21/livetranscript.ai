import{describe,expect,it,vi,afterEach}from'vitest'
afterEach(()=>{vi.resetModules();Reflect.deleteProperty(globalThis,'window')})
describe('desktop overlay bridge',()=>{it('stays browser-safe without claiming click-through',async()=>{const m=await import('./overlay');expect(m.nativeDesktopAvailable()).toBe(false);expect(await m.setNativeOverlayLock(true)).toBe(false);expect(await m.setNativeCaptureProtection()).toBe(false)})})
