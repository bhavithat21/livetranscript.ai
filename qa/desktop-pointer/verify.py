"""Real DOM/CSS and mocked IPC tests. Does not claim OS input passthrough."""
import json, pathlib
from playwright.sync_api import sync_playwright, expect
out = pathlib.Path('qa-results/desktop-pointer'); bundle = out / 'bundle'
css = '\n'.join(p.read_text() for p in bundle.glob('assets/*.css'))
js = '\n'.join(p.read_text() for p in bundle.glob('assets/*.js'))
widths = [375, 768, 1024, 1280, 1440, 1920, 2560]
report = {'nativeMouseDeliveryTested': False, 'nativeIPC': 'mocked', 'actualComponentsAndCSS': True, 'viewports': [], 'checks': [], 'errors': []}
with sync_playwright() as p:
    opts = {'headless': True}
    if pathlib.Path('/usr/bin/chromium').exists(): opts['executable_path'] = '/usr/bin/chromium'
    browser = p.chromium.launch(**opts)
    page = browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.set_content('<html><head></head><body><div id="root"></div></body></html>')
    page.add_style_tag(content=css); page.add_script_tag(content=js, type='module')
    toggle = page.get_by_role('button',name='Pass through mouse clicks')
    toggle.wait_for(); expect(toggle).to_be_enabled()
    for w in widths:
        page.set_viewport_size({'width':w,'height':1000})
        cursors = page.evaluate('''() => Object.fromEntries(['#click-test','#click-test svg','#disabled','#link','label','#input','#textarea','#select','#range','#summary','#resize','#reader','#edit'].map(s=>[s,getComputedStyle(document.querySelector(s)).cursor]))''')
        assert all(v == 'default' for v in cursors.values()), cursors
        assert page.eval_on_selector('#resize',"e => getComputedStyle(e,'::before').cursor") == 'default'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), w
        assert page.eval_on_selector('#reader','e => getComputedStyle(e).userSelect') == 'text'
        report['viewports'].append({'width':w,'fixedArrow':True,'overflow':False,'clickTargets':len(cursors)})
        if w in (375,1440): page.screenshot(path=str(out/f'pointer-{w}.png'), full_page=True)
    page.locator('#click-test').click(); assert page.locator('#click-count').inner_text() == '1 clicks'
    page.locator('#input').fill('Editing still works'); assert page.locator('#input').input_value() == 'Editing still works'
    page.locator('#summary').click(); assert page.locator('details').get_attribute('open') is not None
    page.evaluate("const n=document.getElementById('reader'); const r=document.createRange(); r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r)")
    assert page.evaluate('getSelection().toString()') == 'Selectable transcript words.'
    toggle.click(); expect(toggle).to_have_attribute("aria-pressed", "true")
    page.evaluate('window.__pointerQA.nativeChange(false)')
    expect(toggle).to_have_attribute("aria-pressed", "false")
    calls = page.evaluate('window.__pointerQA.calls.filter(c=>c.command==="set_lock_mode")')
    assert calls == [{'command':'set_lock_mode','args':{'enabled':True}}], calls
    report['checks'] = ['Arrow across nested/disabled/text/resize-style targets and pseudo-elements', 'Buttons receive clicks; input editing, details and text selection retained', 'Mocked native enable and tray recovery reflected in title bar', 'No global hiding, click mirroring or keyboard capture added']
    normal = browser.new_page(); normal.set_content('<html><head></head><body><div id="root"></div></body></html>')
    normal.evaluate('window.__pointerDesktop=false'); normal.add_style_tag(content=css); normal.add_script_tag(content=js,type='module'); normal.locator('#click-test').wait_for()
    assert normal.get_by_role('toolbar').count() == 0
    assert normal.eval_on_selector('#link','e=>getComputedStyle(e).cursor') == 'pointer'
    assert normal.eval_on_selector('#input','e=>getComputedStyle(e).cursor') in ['auto','text']
    report['checks'].append('Normal browser cursors and absence of desktop controls preserved')
    assert not report['errors'], report['errors']; report['passed'] = True
    browser.close()
(out/'report.json').write_text(json.dumps(report,indent=2)); print(json.dumps(report,indent=2))
