"""Real Chromium UI + shared-controller replay checks using fixture providers only."""
import json
import os
import pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path('qa-results/coach')
ROOT.mkdir(parents=True, exist_ok=True)
WIDTHS = [375, 768, 1024, 1280, 1440, 1920, 2560]
report = {'kind': 'real-browser-fixture-qa', 'providerInference': False, 'offlineBundle': bool(os.environ.get('COACH_OFFLINE_BUNDLES')), 'viewports': [], 'checks': []}
def open_fixture(page, entry='index'):
    offline = os.environ.get('COACH_OFFLINE_BUNDLES')
    if not offline:
        page.goto('http://127.0.0.1:4180/' + ('' if entry == 'index' else 'live.html'), wait_until='networkidle')
        return
    # Rendering already-built fixture code in a blank document uses no browser
    # network access. This is not an auth/device test or a production bypass.
    directory = pathlib.Path(offline) / entry / 'assets'
    css = '\n'.join(path.read_text() for path in directory.glob('*.css'))
    page.set_content('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
    # Blank documents lack secure-context randomUUID. Supply fixture-only unique
    # event ids; production still uses the browser crypto API on HTTPS.
    page.evaluate("() => { let n=0; if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', {value: () => 'offline-fixture-' + (++n)}); }")
    page.add_style_tag(content=css)
    scripts = list(directory.glob('*.js'))
    assert len(scripts) == 1, 'Offline QA requires a single self-contained bundle'
    page.add_script_tag(content=scripts[0].read_text(), type='module')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    open_fixture(page)
    page.wait_for_function('window.__coachQA && window.__coachQA.snapshot().results.filter(r=>r.status === "complete").length >= 2')
    page.get_by_role('region', name='Say now', exact=True).wait_for()
    for width in WIDTHS:
        page.set_viewport_size({'width': width, 'height': 1000})
        page.wait_for_timeout(100)
        measurements = page.evaluate('''() => {
          const main = document.querySelector('[data-testid="coach-main"]').getBoundingClientRect();
          const root = document.querySelector('[data-testid="repository-coach"]').getBoundingClientRect();
          const rail = document.querySelector('aside[aria-label="Repository evidence"]').getBoundingClientRect();
          return {mainWidth:main.width,rootWidth:root.width,mainX:main.x,mainY:main.y,railX:rail.x,railY:rail.y,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth};
        }''')
        assert measurements['scrollWidth'] <= width + 1, f'Page overflow at {width}: {measurements}'
        assert measurements['mainWidth'] >= min(580, measurements['rootWidth'] - 4), f'Answer collapsed at {width}: {measurements}'
        if measurements['rootWidth'] < 1002:
            assert measurements['railY'] > measurements['mainY'], f'Rail should stack at {width}'
        else:
            assert measurements['railX'] > measurements['mainX'], f'Rail should be beside answer at {width}'
        assert page.locator('textarea:visible').count() == 0, 'Active canvas unexpectedly exposes a chat composer'
        page.screenshot(path=str(ROOT / f'viewport-{width}.png'), full_page=True)
        report['viewports'].append({'width': width, **measurements, 'passed': True})
    first_calls = page.evaluate('window.__coachQA.calls().length')
    page.evaluate('window.__coachQA.question(window.__coachQA.snapshot().question.text)')
    page.wait_for_timeout(1600)
    assert page.evaluate('window.__coachQA.calls().length') == first_calls, 'Static question loop returned'
    report['checks'].append('Static question remains one request per lane after completion')
    page.evaluate('window.__coachQA.observe(false, "src/controllers/OrderController.ts")')
    assert page.evaluate('window.__coachQA.snapshot().navigation.status') == 'pending', 'Wrong file satisfied navigation'
    report['checks'].append('Wrong file does not satisfy requested test navigation')
    page.wait_for_timeout(900)
    page.evaluate('window.__coachQA.observe(true)')
    page.wait_for_function('window.__coachQA.snapshot().patchReviews.some(r=>r.status === "matches-proposal")')
    report['checks'].append('Observed edit matches proposal without inventing test success')
    assert page.evaluate('window.__coachQA.snapshot().tests.length') == 0
    page.wait_for_timeout(900)
    page.get_by_role('button', name='Mark test start', exact=True).first.click()
    page.evaluate('window.__coachQA.output("Tests: 27 passed, 0 failed")')
    page.wait_for_function('window.__coachQA.snapshot().tests.some(t=>t.status === "observed-pass" && t.codeVersion !== null)')
    page.get_by_role('button', name='Pause coach', exact=True).click()
    paused = page.evaluate('window.__coachQA.calls().length')
    page.evaluate('window.__coachQA.question("Should not answer while paused?")')
    page.wait_for_timeout(900)
    assert page.evaluate('window.__coachQA.calls().length') == paused
    report['checks'].append('Pause prevents further answering')
    assert not errors, f'Browser exceptions: {errors}'
    report['browserErrors'] = errors
    (ROOT / 'fixture-replay.json').write_text(page.evaluate('window.__coachQA.exportReplay()'))
    # Render the REAL navigation shell + LiveInterview + RepositoryCoach together.
    # Only Next Link navigation, audio, image extraction and provider responses
    # are fixture boundaries. This catches nesting/panel-width regressions that
    # an isolated component screenshot cannot establish.
    live = browser.new_page(viewport={'width': 1440, 'height': 1000})
    live.on('pageerror', lambda error: errors.append(str(error)))
    open_fixture(live, 'live')
    live.get_by_role('checkbox', name='I have permission to record', exact=False).check()
    live.get_by_role('checkbox', name='Repository coding interview', exact=False).check()
    live.get_by_role('button', name='Start interview', exact=True).click()
    live.get_by_test_id('repository-coach').wait_for()
    live.evaluate('window.__liveQA.speak("Why does the shipment status test fail?")')
    live.get_by_role('region', name='Say now', exact=True).get_by_text('I would trace', exact=False).wait_for()
    live.get_by_label('Repository screenshots', exact=True).set_input_files({'name': 'synthetic-frame.png', 'mimeType': 'image/png', 'buffer': b'fixture image bytes, parsed by explicit fixture vision adapter'})
    live.get_by_role('region', name='Proposed change in src/services/TrackingService.ts', exact=True).wait_for()
    report['integratedLiveViewports'] = []
    for width in WIDTHS:
        live.set_viewport_size({'width': width, 'height': 1000})
        live.wait_for_timeout(100)
        bounds = live.evaluate("""() => {
          const root = document.querySelector('[data-testid=repository-coach]').getBoundingClientRect();
          const answer = document.querySelector('[data-testid=coach-main]').getBoundingClientRect();
          return {rootWidth:root.width, answerWidth:answer.width, scrollWidth:document.documentElement.scrollWidth};
        }""")
        assert bounds['scrollWidth'] <= width + 1, f'Integrated page overflow {width}: {bounds}'
        assert bounds['answerWidth'] >= min(580, bounds['rootWidth'] - 4), f'Nested live answer collapsed {width}: {bounds}'
        assert live.locator('textarea:visible').count() == 0, 'Integrated Live exposed a chat composer'
        live.screenshot(path=str(ROOT / f'live-viewport-{width}.png'), full_page=True)
        report['integratedLiveViewports'].append({'width': width, **bounds, 'passed': True})
    live.get_by_role('button', name='Pause coach', exact=True).click()
    count = live.evaluate('window.__liveQA.calls().length')
    live.evaluate('window.__liveQA.speak("Should we change the repository next?")')
    live.wait_for_timeout(1200)
    assert live.evaluate('window.__liveQA.calls().length') == count
    # Capture keeps following even while the coding coach is paused.
    live.evaluate('''() => {for(let i=0;i<30;i++)window.__liveQA.speak("Scroll fixture " + i + ": " + "Newly recognized speech remains at the live edge. ".repeat(18));}''')
    for width in WIDTHS:
        live.set_viewport_size({'width':width,'height':1000})
        live.wait_for_function("() => {const s=document.querySelector('#live-transcript .live-scroll-viewport');return s && s.scrollHeight>s.clientHeight && s.scrollHeight-s.scrollTop-s.clientHeight<2}")
        live.evaluate('window.__liveQA.speak("Newest ASR burst: " + "Latest speech at this viewport. ".repeat(20))')
        live.wait_for_function("() => {const s=document.querySelector('#live-transcript .live-scroll-viewport');return s.scrollHeight-s.scrollTop-s.clientHeight<2}")
    live.get_by_role('button',name='Hide transcript',exact=True).click()
    live.evaluate('window.__liveQA.speak("Hidden tab latest ASR text remains current")')
    live.get_by_role('button',name='Transcript',exact=True).click()
    live.wait_for_function("() => {const s=document.querySelector('#live-transcript .live-scroll-viewport');return s && s.scrollHeight-s.scrollTop-s.clientHeight<2}")
    assert live.get_by_text('Hidden tab latest ASR text remains current',exact=True).is_visible()
    report['checks'].append('Actual Live transcript rail follows burst speech and resize at seven widths; reopening shows newest captured speech')
    live.get_by_role('button', name='End', exact=True).click()
    live.get_by_role('button', name='Start interview', exact=True).wait_for()
    assert live.get_by_test_id('repository-coach').count() == 0
    report['checks'].append('Integrated Live mounts the coach after consent, grounds a screenshot, pauses, and unmounts on End')
    assert not errors, f'Browser exceptions: {errors}'
    browser.close()
report['passed'] = True
(ROOT / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
