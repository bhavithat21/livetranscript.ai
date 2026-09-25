"""Real Chromium UI + shared-controller replay checks using fixture providers only."""
import json
import pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path('qa-results/coach')
ROOT.mkdir(parents=True, exist_ok=True)
WIDTHS = [375, 768, 1024, 1280, 1440, 1920, 2560]
report = {'kind': 'real-browser-fixture-qa', 'providerInference': False, 'viewports': [], 'checks': []}
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:4180', wait_until='networkidle')
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
    browser.close()
report['passed'] = True
(ROOT / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
