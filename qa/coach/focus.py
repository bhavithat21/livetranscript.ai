"""Actual Live UI, detector, router and streaming feed. ASR/provider outputs are
explicit fixtures. Photo-visible setup sentences + synthetic async-report task;
this is NOT playback, transcription or accuracy evaluation of the YouTube audio."""
import json, pathlib
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path('qa-results/focus'); ROOT.mkdir(parents=True,exist_ok=True)
WIDTHS=[375,768,1024,1280,1440,1920,2560]
report={'providerInference':False,'actualVideoPlayback':False,'fixture':'photo-setup-plus-synthetic-report-task','checks':[],'layouts':[]}
with sync_playwright() as p:
  browser=p.chromium.launch()
  page=browser.new_page(viewport={'width':1440,'height':1000})
  errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:4180/live.html',wait_until='networkidle')
  assert page.get_by_role('link',name='AI workspace',exact=True).count()==0 or not page.get_by_role('link',name='AI workspace',exact=True).first.is_visible()
  assert page.get_by_role('link',name='Transcripts',exact=True).first.is_visible()
  page.get_by_role('checkbox',name='I have permission',exact=False).check()
  page.screenshot(path=str(ROOT/'setup-1440.png'),full_page=True)
  page.get_by_role('button',name='Start interview',exact=True).click()
  page.get_by_role('region',name='AI answer',exact=True).wait_for()
  page.evaluate("window.__liveQA.speak('Today we are doing a technical interview.')")
  page.evaluate("window.__liveQA.speak('You will be allowed to use an AI coding agent.')")
  page.evaluate("window.__liveQA.speak('How does that sound?')")
  page.wait_for_timeout(1600)
  assert page.evaluate('window.__liveQA.answers().length')==0
  report['checks'].append('Setup/social remarks do not trigger a technical answer')
  page.evaluate("window.__liveQA.speak('How would you')")
  page.wait_for_timeout(1200)
  assert page.evaluate('window.__liveQA.answers().length')==0
  page.evaluate("window.__liveQA.speak('make report generation')")
  page.wait_for_timeout(150)
  page.evaluate("window.__liveQA.speak('asynchronous?')")
  page.wait_for_function('window.__liveQA.answers().length===1')
  page.get_by_role('region',name='AI answer').get_by_text('For this question:',exact=False).wait_for()
  assert page.evaluate('window.__liveQA.answers()[0].question')=='How would you make report generation asynchronous?'
  page.evaluate("window.__liveQA.speak('Why not guess the entire implementation?', 'mic', 0)")
  page.wait_for_timeout(1600)
  assert page.evaluate('window.__liveQA.answers().length')==1
  report['checks'].append('Joins fragmented incoming speech; candidate microphone cannot self-trigger')
  page.evaluate("window.__liveQA.speak('Explain the slow fixture task.', 'system', 1)")
  page.wait_for_function('window.__liveQA.answers().length===2')
  page.evaluate("window.__liveQA.speak('I would inspect the status endpoint.', 'mic', 0)")
  page.wait_for_timeout(20)
  page.evaluate("window.__liveQA.speak('How would you handle cancellation?', 'system', 1)")
  page.wait_for_function('window.__liveQA.answers().length===3 && window.__liveQA.answers()[1].aborted')
  page.get_by_role('region',name='AI answer').get_by_text('For this question: How would you handle cancellation?',exact=False).wait_for()
  report['checks'].append('New turn aborts a stalled obsolete answer and displays the newest question')
  page.wait_for_timeout(3000)
  assert page.evaluate('window.__liveQA.answers().length')==3, page.evaluate('window.__liveQA.answers()')
  # Multiple voices are displayed instead of repeated generic interviewer labels.
  assert page.locator('#live-transcript').get_by_text('Call · Speaker 1',exact=True).count()>0
  assert page.locator('#live-transcript').get_by_text('Call · Speaker 2',exact=True).count()>0
  assert page.locator('#live-transcript').get_by_text('Microphone · Speaker 1',exact=True).count()>0
  # Three chunks of the question share one readable block.
  assert page.locator('#live-transcript p').filter(has_text='make report generation').count()==1
  report['checks'].append('Actual voice/channel labels survive rendering and contiguous fragments are grouped')
  page.locator('#live-transcript summary').click()
  page.get_by_label('Interviewer voice').select_option('1')
  page.evaluate("window.__liveQA.speak('Why should another caller self-trigger?', 'system', 0)")
  page.wait_for_timeout(1400)
  assert page.evaluate('window.__liveQA.answers().length')==3, page.evaluate('window.__liveQA.answers()')
  report['checks'].append('Explicit interviewer selection excludes other call voices without guessing identity')
  page.locator('#live-transcript summary').click()
  for theme in ['light','dark']:
    page.evaluate('(v)=>document.documentElement.classList.toggle("lt-dark",v)',theme=='dark')
    page.screenshot(path=str(ROOT/f'dialogue-{theme}-1440.png'),full_page=True)
  page.get_by_role('button',name='Pause answers',exact=True).click()
  # Burst text while paused tests grouping and latest-edge scrolling independently.
  page.evaluate("() => {for(let i=0;i<24;i++)window.__liveQA.speak('Observation '+i+': '+ 'The latest evidence is visible in this readable voice turn. '.repeat(5),'system',i%2)}")
  for theme in ['light','dark']:
    page.evaluate('(v)=>document.documentElement.classList.toggle("lt-dark",v)',theme=='dark')
    for width in WIDTHS:
      page.set_viewport_size({'width':width,'height':1000})
      for percent in [100,175,200]:
        control=page.locator('summary[aria-label="Text size and reading preferences"]')
        if not page.locator('details:has(>summary[aria-label="Text size and reading preferences"])').get_attribute('open') == '': control.click()
        field=page.get_by_label('Custom text size percent')
        field.fill(str(percent)); field.press('Tab')
        bounds=field.evaluate('(e)=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}}')
        assert bounds['left']>=0 and bounds['right']<=width
        control.click()
        page.wait_for_function("() => {const s=document.querySelector('#live-transcript .live-scroll-viewport');return s && Math.abs(s.scrollHeight-s.scrollTop-s.clientHeight)<2}")
        measured=page.locator('#live-transcript .live-scroll-viewport p').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')
        assert abs(measured-18*percent/100)<.1,(percent,measured)
        scroll=page.evaluate('document.documentElement.scrollWidth')
        assert scroll<=width+1, (width,percent,scroll)
        report['layouts'].append({'width':width,'theme':theme,'percent':percent,'transcriptPx':measured,'passed':True})
        if percent in [100,175] and width in [375,1440]: page.screenshot(path=str(ROOT/f'live-{theme}-{width}-{percent}.png'),full_page=True)
  report['checks'].append('Four primary destinations, resizable grouped speech and popup bounds at seven widths and two themes')
  assert not errors,errors
  report['browserErrors']=errors;report['answerRequests']=page.evaluate('window.__liveQA.answers()')
  browser.close()
report['passed']=True
(ROOT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
