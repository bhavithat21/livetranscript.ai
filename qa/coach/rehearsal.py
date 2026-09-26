"""Browser wiring, real IndexedDB persistence, no real audio/providers."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(os.environ.get('REHEARSAL_QA_OUT','qa-results/rehearsal'));out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH') or None,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.goto('http://127.0.0.1:4180/rehearsal.html')
    page.get_by_role('button',name='Check test configuration').click()
    page.get_by_text('Blocked:',exact=False).wait_for()
    assert page.get_by_role('button',name='Start interview').count()==0
    page.get_by_label('Session title',exact=True).fill('QA persistent video session')
    page.get_by_label('Split',exact=True).select_option('holdout')
    page.evaluate('window.__rehearsalQA.configure()');page.get_by_role('button',name='Check test configuration').click()
    page.get_by_role('button',name='Start interview').wait_for()
    page.get_by_label('I have permission to record',exact=False).check()
    page.get_by_role('button',name='Start interview').click()
    page.evaluate("window.__rehearsalQA.speak('Can you find a route through this maze?', 'system', 0)")
    page.locator('summary').filter(has_text='Speakers').click()
    page.get_by_label('Interviewer voice').select_option('0')
    page.wait_for_timeout(2200)
    count=page.evaluate('window.__rehearsalQA.requests().length')
    page.evaluate("window.__rehearsalQA.speak('Now allow diagonal moves.', 'system', 0)")
    page.wait_for_function("window.__rehearsalQA.requests().some(p => p.task.spokenRequirements?.some(r=>r.text==='allow diagonal moves'))")
    page.wait_for_timeout(1500)
    after=page.evaluate('window.__rehearsalQA.requests().length');assert after>count
    page.evaluate("window.__rehearsalQA.speak('Add an unrelated button.', 'mic', 0)")
    page.wait_for_timeout(1600)
    assert page.evaluate('window.__rehearsalQA.requests().length')==after
    page.get_by_role('button',name='End',exact=True).click()
    page.get_by_role('heading',name='Review after the run').wait_for()
    page.get_by_text('Holdout run:',exact=False).wait_for()
    # Editing setup for the next session must not relabel this completed holdout.
    page.get_by_label('Split',exact=True).select_option('tuning')
    assert page.get_by_text('Holdout run:',exact=False).count()==1
    page.get_by_role('button',name='Add expected event').click()
    page.get_by_label('Expected words',exact=True).fill('Independent hidden expectation NOT IN GENERATION')
    page.get_by_label('Detection verdict',exact=True).select_option('missed')
    page.wait_for_timeout(2200)
    assert not page.evaluate("JSON.stringify(window.__rehearsalQA.requests()).includes('Independent hidden expectation')")
    assert page.evaluate('window.__rehearsalQA.requests().length')==after
    page.get_by_label('I have reviewed the export scope:',exact=False).check()
    with page.expect_download() as dl:page.get_by_role('button',name='Export rehearsal evidence').click()
    dl.value.save_as(str(out/'fixture-export.json'))
    data=json.loads((out/'fixture-export.json').read_text())
    assert data['accuracy'] is None and data['readiness']=='not-certified'
    assert data['observed']['returnedModelResponses']==0
    assert data['metadata']['split']=='holdout'
    assert data['benchmarks']['questionCoverage']['recall']==0
    assert data['finalTranscript'] and data['sessionId']
    assert data['configuration']['commit']=='UI-fixture-not-a-production-commit'
    page.get_by_role('button',name='View saved report').first.wait_for()
    page.reload();page.get_by_role('button',name='View saved report').first.wait_for()
    assert page.evaluate('window.__rehearsalQA.requests().length')==0
    page.get_by_role('button',name='View saved report').first.click()
    page.get_by_role('heading',name='Read-only saved report:',exact=False).wait_for()
    assert page.evaluate('window.__rehearsalQA.requests().length')==0
    widths=[]
    for width in [375,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
        widths.append(width)
    page.screenshot(path=str(out/'saved-report-1440.png'),full_page=True)
    page.goto('http://127.0.0.1:4180/rehearsal.html?owner=other-account')
    page.get_by_text('No saved sessions for this account and site.',exact=True).wait_for()
    assert page.get_by_role('button',name='View saved report').count()==0
    page.goto('http://127.0.0.1:4180/rehearsal.html')
    page.get_by_role('button',name='Delete saved session').first.wait_for()
    page.get_by_role('button',name='Delete saved session').first.click()
    page.get_by_text('No saved sessions for this account and site.',exact=True).wait_for()
    assert not errors,errors
    (out/'report.json').write_text(json.dumps({'kind':'offline-browser-storage-contract','realAudio':False,'realVision':False,'providerInference':False,'requirementRequestsBefore':count,'requirementRequestsAfter':after,'widths':widths,'errors':errors,'exportUncertified':True,'indexedDBSaveReload':True,'accountScoping':True,'readOnlyNoInference':True,'deleteVerified':True,'holdoutMetadataFrozen':True,'reviewAnnotationsExcludedFromGeneration':True},indent=2))
    browser.close()
