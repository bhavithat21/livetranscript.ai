"""Browser coordinates/collisions and stale-pin suppression, NOT native/vision accuracy."""
import json,pathlib,re
from playwright.sync_api import sync_playwright,expect
out=pathlib.Path('qa-results/inline-coach');bundle=out/'bundle'
html=(bundle/'index.html').read_text();html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html)
css='\n'.join(p.read_text() for p in bundle.glob('assets/*.css'));js='\n'.join(p.read_text() for p in bundle.glob('assets/*.js'))
report={'nativeInputTested':False,'visionTested':False,'fixture':'synthetic-editor-native-IPC-mocked','layouts':[],'checks':[],'errors':[]}
with sync_playwright() as p:
 opts={'headless':True}
 if pathlib.Path('/usr/bin/chromium').exists():opts['executable_path']='/usr/bin/chromium'
 browser=p.chromium.launch(**opts);page=browser.new_page(viewport={'width':1440,'height':900})
 page.on('pageerror',lambda e:report['errors'].append(str(e)))
 page.set_content(html);page.add_style_tag(content=css);page.add_script_tag(content=js,type='module')
 for width in [375,768,1024,1280,1440,1920,2560]:
  page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(450)
  card=page.get_by_role('region',name='Inline edit suggestion');expect(card).to_be_visible()
  target=page.locator('#code10').bounding_box();highlight=page.get_by_test_id('inline-highlight').bounding_box();box=card.bounding_box()
  assert abs(highlight['x']-(target['x']-3))<1 and abs(highlight['y']-(target['y']-2))<1,(target,highlight)
  assert not (box['x']<target['x']+target['width'] and box['x']+box['width']>target['x'] and box['y']<target['y']+target['height'] and box['y']+box['height']>target['y']),box
  assert box['x']>=0 and box['x']+box['width']<=width
  assert page.locator('section pre').inner_text()=='if (ready && paid) {'
  assert page.locator('[data-inline-root] section').evaluate('e=>getComputedStyle(e).pointerEvents')=='none'
  report['layouts'].append({'width':width,'targetAndHighlightAligned':True,'calloutDoesNotCoverTarget':True,'card':box})
  if width in [375,1440]:page.screenshot(path=str(out/f'inline-{width}.png'))
 for _ in range(12):
  expect(page.get_by_test_id('inline-highlight')).to_be_visible();page.wait_for_timeout(100)
 report['checks'].append('No pin blinking between local sample/render timer updates')
 for reason in ['scroll','wrong-file','lost-focus','hold','viewport']:
  page.evaluate(f'window.__inlineQA.change("{reason}")');expect(page.get_by_test_id('inline-highlight')).to_have_count(0)
  page.evaluate('window.__inlineQA.reset()');expect(page.get_by_test_id('inline-highlight')).to_be_visible()
  report['checks'].append('Pin removed for '+reason)
 assert not report['errors'],report['errors']
 report['passed']=True;browser.close()
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
