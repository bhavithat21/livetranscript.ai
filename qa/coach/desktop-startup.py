"""Desktop UI contracts with explicit native IPC/audio/model fixtures, not OS permission proof."""
import json
import os
import pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path('qa-results/desktop-startup')
root.mkdir(parents=True, exist_ok=True)
script = """
window.__nativeCalls=[];window.__nativeLocked=false;window.__denyCapture=true;
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:async(command,args)=>{
 window.__nativeCalls.push({command,args});
 if(command==='get_lock_mode')return window.__nativeLocked;
 if(command==='set_lock_mode'){window.__nativeLocked=args.enabled;return;}
 if(command==='coach_displays')return [{id:'1',name:'Built-in display',width:1440,height:900},{id:'2',name:'External display',width:1920,height:1080}];
 if(command==='coach_start'){if(window.__denyCapture)throw 'Enable Screen Recording permission and reopen LiveTranscript';return {leaseId:'fixture-lease'};}
 if(command==='coach_sample')return {pixels:[0,1,2,3],width:2,height:2};
 if(command==='coach_grab')return new Uint8Array([255,216,255,217]).buffer;
 return undefined;
}};
document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('lt-desktop'));
"""
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('QA_BROWSER_EXECUTABLE'))
    page = browser.new_page(viewport={'width':1440,'height':900})
    page.add_init_script(script)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:4180/live.html')
    page.get_by_role('region',name='Live interview options',exact=True).wait_for()
    for name in ['What to do next','What to say','What to write']:
        panel=page.get_by_role('region',name=name,exact=True)
        assert panel.is_visible(), name
        bounds=panel.bounding_box()
        assert bounds['x']>=260 and bounds['x']+bounds['width']<=1440, (name,bounds)
    assert page.get_by_role('button',name='Start interview',exact=True).is_disabled()
    assert page.evaluate('window.__nativeCalls.every(c=>!c.command.includes("set_size")&&!c.command.includes("maximize")&&c.command!=="coach_start")')
    page.screenshot(path=str(root/'ready.png'))
    page.get_by_role('checkbox',name='I have permission to record and use AI assistance.').check()
    page.get_by_role('button',name='Start interview',exact=True).click()
    page.get_by_role('button',name='End interview',exact=True).wait_for()
    page.get_by_label('Overlay display').select_option('2')
    page.get_by_role('button',name='Enable screen sharing',exact=True).click()
    page.get_by_role('button',name='Retry screen sharing',exact=True).wait_for()
    assert page.get_by_role('region',name='Live interview options').get_by_role('alert').is_visible()
    page.get_by_role('button',name='Open screen permission settings').click()
    page.wait_for_function('window.__nativeCalls.some(c=>c.command==="coach_open_screen_settings")')
    page.evaluate('window.__denyCapture=false')
    page.get_by_role('button',name='Retry screen sharing',exact=True).click()
    page.get_by_role('button',name='Stop sharing',exact=True).wait_for()
    page.wait_for_function('window.__nativeCalls.some(c=>c.command==="coach_start"&&c.args.displayId==="2")')
    page.get_by_role('button',name='Pause screen watch',exact=True).click()
    page.get_by_role('button',name='Watch changes',exact=True).wait_for()
    page.get_by_role('button',name='Stop sharing',exact=True).click()
    page.get_by_role('button',name='Enable screen sharing',exact=True).wait_for()
    page.screenshot(path=str(root/'active.png'))
    page.get_by_role('button',name='Move & resize',exact=True).click()
    page.wait_for_function('window.__nativeLocked')
    page.evaluate('window.__nativeLocked=false')
    page.get_by_role('button',name='Move & resize',exact=True).wait_for()
    page.get_by_role('button',name='Hide',exact=True).click()
    page.wait_for_function('window.__nativeCalls.some(c=>c.command==="plugin:window|hide")')
    # Renders and manual viewport changes must never maximize or shrink the native window.
    calls=page.evaluate('window.__nativeCalls')
    assert len([c for c in calls if c['command']=='plugin:window|maximize'])==1
    for width in [1024,768,390,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.get_by_role('button',name='End interview').is_visible()
        assert page.get_by_role('region',name='What to write',exact=True).is_visible()
    assert page.evaluate('window.__nativeCalls.filter(c=>c.command==="plugin:window|maximize").length')==1
    page.get_by_role('button',name='End interview',exact=True).click()
    page.get_by_role('button',name='Start interview',exact=True).wait_for()
    assert not errors, errors
    (root/'report.json').write_text(json.dumps({'kind':'desktop-ui-mocked-ipc','osCaptureVerified':False,'passed':True,'nativeCalls':calls},indent=2))
    browser.close()
print('Desktop startup, dock, screen permission/retry, hide and unlock UI checks passed.')
