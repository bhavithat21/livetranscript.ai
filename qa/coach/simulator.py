"""Browser checks of the actual simulator. No model inference or video playback."""
import json, pathlib, os
from playwright.sync_api import sync_playwright
out=pathlib.Path('qa-results/coach');out.mkdir(parents=True,exist_ok=True)
result={'kind':'real-browser-simulator-qa','providerInference':False,'viewports':[], 'checks':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get("QA_CHROMIUM_EXECUTABLE"))
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append(r.url) if '/api/' in r.url else None)
    offline=os.environ.get('SIMULATOR_OFFLINE_BUNDLE')
    if offline:
        assets=pathlib.Path(offline)/'assets'
        page.set_content('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
        page.add_style_tag(content='\n'.join(f.read_text() for f in assets.glob('*.css')))
        bundles=list(assets.glob('*.js'));assert len(bundles)==1
        page.add_script_tag(content=bundles[0].read_text(),type='module')
    else:
        page.goto('http://127.0.0.1:4180/simulator.html')
    result['offlineBundle']=bool(offline)
    page.get_by_role('button',name='Run to end',exact=True).wait_for()
    page.get_by_label('Simulation scenario',exact=True).select_option('conversation')
    page.get_by_role('button',name='Run to end',exact=True).click()
    page.get_by_role('region',name='Scenario result',exact=True).get_by_role('heading',name='PASS',exact=False).wait_for()
    assert 'candidate' in page.get_by_role('region',name='Real-time simulator',exact=True).inner_text()
    for width in [375,768,1024,1280,1440,1920,2560]:
        page.set_viewport_size({'width':width,'height':1000})
        page.wait_for_timeout(100)
        metrics=page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
        assert metrics['scroll']<=metrics['width']+1,metrics
        result['viewports'].append({**metrics,'passed':True})
        if width in [375,1440]:page.screenshot(path=str(out/f'simulator-{width}.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1000})
    page.get_by_role('button',name='Reset scenario',exact=True).click()
    page.get_by_role('button',name='Play in real time',exact=True).click()
    page.wait_for_timeout(1300)
    page.get_by_role('button',name='Pause timeline',exact=True).click()
    frozen=page.get_by_role('progressbar',name='Simulation progress').get_attribute('value')
    page.wait_for_timeout(400)
    assert page.get_by_role('progressbar',name='Simulation progress').get_attribute('value')==frozen
    assert float(frozen)>0
    page.get_by_role('button',name='Next event',exact=True).click()
    page.wait_for_timeout(200)
    assert float(page.get_by_role('progressbar',name='Simulation progress').get_attribute('value'))>float(frozen)
    page.get_by_role('button',name='Run all 13 scenarios',exact=True).click()
    page.get_by_role('heading',name='Runtime checks · 13/13 scenarios passed',exact=True).wait_for()
    assert not requests,requests
    assert not errors,errors
    result['checks']=['All 13 scenarios pass from the actual UI','Realtime play advances virtual events','Pause freezes timeline','Next event steps forward','Seven widths without page overflow','No API calls or browser exceptions']
    result['passed']=True
    browser.close()
(out/'simulator-browser.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
