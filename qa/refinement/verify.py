"""Real components, synthetic transcript, no ASR/model calls. Fonts asserted in CI."""
import json, os, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path('qa-results/refinement'); ROOT.mkdir(parents=True, exist_ok=True)
WIDTHS = [375, 768, 1024, 1280, 1440, 1920, 2560]
report = {'kind':'browser-presentation-regression', 'realASR':False, 'fontVerified':False, 'layouts':[], 'checks':[]}
def lum(rgb):
    v=[x/255 for x in rgb]
    v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
    return sum(x*y for x,y in zip(v,[.2126,.7152,.0722]))
def rgb(hex):
    value=hex.strip().lstrip('#')
    if len(value)==3: value=''.join(c*2 for c in value)
    return [int(value[i:i+2],16) for i in (0,2,4)]
def contrast(a,b):
    x,y=sorted([lum(rgb(a)),lum(rgb(b))]); return (y+.05)/(x+.05)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    errors=[]; page.on('pageerror',lambda error: errors.append(str(error)))
    offline=os.environ.get('REFINEMENT_OFFLINE')
    if offline:
        folder=pathlib.Path(offline)/'assets'
        page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
        page.add_style_tag(content='\n'.join(f.read_text() for f in folder.glob('*.css')))
        scripts=list(folder.glob('*.js')); assert len(scripts)==1
        page.add_script_tag(content=scripts[0].read_text(),type='module')
    else:
        page.goto('http://127.0.0.1:4181',wait_until='networkidle')
    page.wait_for_function('window.__refinementQA')
    page.evaluate('document.fonts.ready')
    faces=page.evaluate("[...document.fonts].filter(f=>/geist/i.test(f.family)).map(f=>({family:f.family,status:f.status}))")
    report['fontFaces']=faces
    if not offline:
        assert any(f['status']=='loaded' and 'fallback' not in f['family'].lower() and 'mono' not in f['family'].lower() for f in faces), 'No real Geist Sans face loaded'
        assert any(f['status']=='loaded' and 'fallback' not in f['family'].lower() and 'mono' in f['family'].lower() for f in faces), 'No real Geist Mono face loaded'
        report['fontVerified']=True
    # Exercise the same real reader switches before viewport checks.
    expected=page.evaluate('window.__refinementQA.expected')
    for text in expected: assert text in page.locator('body').inner_text()
    page.get_by_role('button',name='Original segments',exact=True).click()
    for text in expected: assert text in page.locator('body').inner_text()
    page.get_by_role('button',name='Reading view',exact=True).click()
    assert page.get_by_text('Unfinalized',exact=True).count()==1
    report['checks'].append('All authored words survive both views; provisional words remain marked')
    for theme in ['light','dark']:
        page.evaluate('window.__refinementQA.show("transcript")')
        page.get_by_role('button',name='Reading view',exact=True).wait_for()
        # Use the actual shared theme control once, then preserve it across views.
        if theme=='dark': page.get_by_role('button',name='Switch to dark mode').first.click()
        tokens=page.evaluate("() => {const s=getComputedStyle(document.documentElement);return Object.fromEntries(['paper','reader','ink','muted','signal','primary-fill','primary-hover'].map(k=>[k,s.getPropertyValue('--'+k).trim()]));}")
        pairs=[('ink','paper'),('ink','reader'),('muted','paper'),('muted','reader'),('signal','reader')]
        ratios={a+'/'+b:contrast(tokens[a],tokens[b]) for a,b in pairs}
        ratios['button']=contrast('#ffffff',tokens['primary-fill']); ratios['button-hover']=contrast('#ffffff',tokens['primary-hover'])
        for name,value in ratios.items(): assert value>=4.5, f'Contrast {theme} {name}: {value}'
        report.setdefault('contrast',{})[theme]=ratios
        for view in ['transcript','home','settings']:
            page.evaluate('(view)=>window.__refinementQA.show(view)',view)
            if view=='settings': page.get_by_role('tab',name='Audio',exact=True).click()
            page.wait_for_timeout(150)
            for width in WIDTHS:
                page.set_viewport_size({'width':width,'height':1000}); page.wait_for_timeout(100)
                size=page.evaluate('({viewport:innerWidth,scroll:document.documentElement.scrollWidth,font:getComputedStyle(document.body).fontFamily})')
                assert size['scroll']<=width+1, f'Overflow {theme} {view} {width}: {size}'
                if view=='transcript':
                    assert page.get_by_role('button',name='Reading view').get_attribute('aria-pressed')=='true'
                    for text in expected: assert text in page.locator('body').inner_text()
                if width in [375,1440]: page.screenshot(path=str(ROOT/f'{view}-{theme}-{width}.png'),full_page=True)
                report['layouts'].append({'theme':theme,'view':view,**size,'passed':True})
    # Live text is rendered by the real TranscriptView/ChatView and follow controller.
    # Recognition text is synthetic; this exercises scrolling, not microphone quality.
    report['liveLayouts'] = []
    for theme in ['light', 'dark']:
        page.evaluate('(dark)=>document.documentElement.classList.toggle("lt-dark",dark)',theme=='dark')
        for view in ['live', 'chat']:
            page.evaluate('(view)=>window.__refinementQA.show(view)',view)
            for width in WIDTHS:
                page.set_viewport_size({'width':width,'height':1000})
                page.evaluate('window.__refinementQA.reset();window.__refinementQA.append(40)')
                selector='.live-scroll-viewport'
                page.wait_for_function("() => {const s=document.querySelector('.live-scroll-viewport');return s && s.scrollHeight>s.clientHeight && Math.abs(s.scrollHeight-s.scrollTop-s.clientHeight)<2}")
                viewport=page.locator(selector)
                page.evaluate('window.__refinementQA.revise()')
                page.wait_for_function("() => {const s=document.querySelector('.live-scroll-viewport');return s.scrollHeight-s.scrollTop-s.clientHeight<2}")
                viewport.hover(); page.mouse.wheel(0,-600)
                page.get_by_role('button',name='Jump to latest',exact=False).wait_for()
                page.wait_for_timeout(250)
                top=viewport.evaluate('(s)=>s.scrollTop')
                page.evaluate('window.__refinementQA.append(40)')
                page.wait_for_timeout(120)
                assert abs(top-viewport.evaluate('(s)=>s.scrollTop'))<2, f'History reading was interrupted {theme}/{view}/{width}'
                page.get_by_role('button',name='Jump to latest',exact=False).click()
                page.wait_for_function("() => {const s=document.querySelector('.live-scroll-viewport');return s.scrollHeight-s.scrollTop-s.clientHeight<2}")
                page.evaluate('window.__refinementQA.scale(1.3)')
                page.wait_for_timeout(120)
                metrics=viewport.evaluate('(s)=>({top:s.scrollTop,height:s.clientHeight,scroll:s.scrollHeight})')
                assert abs(metrics['scroll']-metrics['top']-metrics['height'])<2, f'Resize lost live edge: {metrics}'
                assert page.evaluate('document.documentElement.scrollWidth')<=width+1
                if width in [375,1440]:page.screenshot(path=str(ROOT/f'{view}-{theme}-{width}.png'),full_page=True)
                report['liveLayouts'].append({'theme':theme,'view':view,'width':width,'passed':True,**metrics})
    report['checks'].append('28 live layouts: large batches, revised finals, user-history pause, Jump to latest and text reflow verified')
    page.evaluate('window.__refinementQA.show("home")')
    page.set_viewport_size({'width':1440,'height':1000})
    page.wait_for_timeout(100)
    page.get_by_role('button',name='Pause motion',exact=True).click()
    page.wait_for_timeout(50)
    assert page.locator('[data-motion-paused]').count()==1
    assert page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")==0
    page.emulate_media(reduced_motion='reduce')
    page.get_by_role('heading',name='Before you press play.',exact=False).scroll_into_view_if_needed()
    assert page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")==0
    report['checks'].append('Pause motion and reduced-motion leave content visible with zero running decorative animations')
    page.evaluate('window.__refinementQA.show("transcript")')
    assert page.locator('.live-scroll-area[data-flow="true"]').count()==1
    report['checks'].append('Archived shared document retains normal page scrolling, never forced to its latest line')
    assert not errors, errors
    report['browserErrors']=errors
    (ROOT/'report.json').write_text(json.dumps(report,indent=2))
    browser.close()
print(json.dumps({'layouts':len(report['layouts']),'liveLayouts':len(report['liveLayouts']),'fontVerified':report['fontVerified'],'errors':errors}))
