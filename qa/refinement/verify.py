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
    assert not errors, errors
    report['browserErrors']=errors
    (ROOT/'report.json').write_text(json.dumps(report,indent=2))
    browser.close()
print(json.dumps({'layouts':len(report['layouts']),'fontVerified':report['fontVerified'],'errors':errors}))
