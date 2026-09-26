"""Pixel-only benchmark. DOM is used by the TEST DRIVER solely to create scenes
and record independent labels; the production Rust tracker receives PGM pixels
and an INITIAL reference seed, never future rectangles, scroll offsets or text.
No real vision/ASR/LLM providers or native compositor/input are exercised here.
"""
import io, json, os, pathlib, statistics, subprocess, time
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT/'qa-results/visual-tracker'; OUT.mkdir(parents=True, exist_ok=True)
RUNNER = pathlib.Path(os.environ.get('PIXEL_RUNNER', str(OUT/'pixel-runner')))
HTML = '''<!doctype html><style>
*{box-sizing:border-box}body{margin:0;background:#171615;color:#e9e5df;font-family:monospace}header{height:74px;padding:25px 210px;background:#262421;border-bottom:1px solid #45413c;white-space:pre;font:16px monospace}aside{position:absolute;top:74px;left:0;bottom:0;width:196px;background:#24221f;padding:30px 15px;color:#b3aa9d}.editor{position:absolute;left:200px;top:86px;right:20px;bottom:126px;overflow:scroll;background:#171615}.lines{padding:0 60px;width:1500px}.line{height:24px;line-height:24px;white-space:pre;font-size:16px}.line span{display:inline-block;height:24px}.terminal{position:absolute;bottom:0;height:110px;width:100%;padding:16px 220px;background:#27241f}.cover{position:absolute;display:none;z-index:2;background:#49443a;padding:14px;color:white}
</style><header id="identity">src / shipping.ts · example repository · screenshot-only test</header><aside>EXPLORER<br><br>src<br>  shipping.ts<br>  tests.ts</aside><div class="editor" id="editor"><div class="lines" id="lines"></div></div><div class="terminal" id="terminal">$ npm test<br>Awaiting a real command — benchmark scene only.</div><div class="cover" id="cover">Completion menu</div><script>(()=>{
const code=Array.from({length:95},(_,i)=>`  const value${i} = items[${i}] ?? fallback${i};`);
code.splice(27,7,'export function canShip(order: Order) {','  const ready = order.inventory === "allocated";','  const paid = order.payment === "settled";','  if (ready || paid) {','    return shipmentQueue.enqueue(order.id);','  }','  return false;');
lines.innerHTML=code.map((v,i)=>`<div class="line" id="row${i}"><span></span></div>`).join('');code.forEach((v,i)=>document.querySelector(`#row${i} span`).textContent=v);editor.scrollTop=480;
})();</script>'''

def rectangle(page, selector, scale):
    r=page.locator(selector).bounding_box()
    # Round endpoints, never origin and size independently: at 125% DPI,
    # round(987.5)+round(137.5) reaches 1126 in a 1125px screenshot.
    x,y=round(r['x']*scale),round(r['y']*scale)
    return [x,y,round((r['x']+r['width'])*scale)-x,round((r['y']+r['height'])*scale)-y]
def screenshot(page,name):
    data=page.screenshot();im=Image.open(io.BytesIO(data)).convert('L');p=OUT/(name+'.pgm');im.save(p);return p

def run_sequence(page,width,scale,label,actions):
    print('CASE',label,flush=True);page.set_default_timeout(5000)
    page.set_content(HTML);page.wait_for_timeout(30)
    base=screenshot(page,f'{label}-base')
    t=rectangle(page,'#row30 span',scale)
    upper=rectangle(page,'#row27 span',scale); lower=rectangle(page,'#row33 span',scale)
    nearby=[rectangle(page,f'#row{i} span',scale) for i in range(27,34)]
    cx=min(v[0] for v in nearby)-round(4*scale);cy=upper[1]
    c=[cx,cy,max(v[0]+v[2] for v in nearby)-cx+round(4*scale),lower[1]+lower[3]-cy]
    search=rectangle(page,'#editor',scale)
    client=page.evaluate('({width:editor.clientWidth,height:editor.clientHeight})')
    search[2]=round(client['width']*scale);search[3]=round(client['height']*scale)
    identity=rectangle(page,'#identity',scale)
    seed=t+c+search+identity+rectangle(page,'#terminal',scale)
    frames=[]; labels=[]
    for n,(name,script,expected) in enumerate(actions):
        if script:page.evaluate(script)
        page.wait_for_timeout(18)
        target=rectangle(page,'#row30 span',scale)
        frames.append(screenshot(page,f'{label}-{n:03d}-{name}'))
        labels.append({'name':name,'expected':expected,'trueRect':target})
    result=subprocess.run([str(RUNNER),str(base),','.join(map(str,seed)),*map(str,frames)],text=True,capture_output=True,check=True,timeout=30)
    if result.stdout.startswith('SEED_ERROR'):return {'case':label,'seedFailure':result.stdout.strip(),'requestedFrames':len(labels),'width':width,'deviceScale':scale,'passed':False}
    outputs=[]
    for meta,line in zip(labels,result.stdout.strip().splitlines(),strict=True):
        a=line.split(',');status=a[1];box=list(map(int,a[2:6]));ms=float(a[6]);expected=meta['expected'];should_track=expected=='tracking'
        error=max(abs(box[i]-meta['trueRect'][i]) for i in (0,1)) if status=='tracking' else None
        dirty=a[9]=='true' if len(a)>9 else None
        expected_dirty = meta['name'] in ['terminal', 'return', 'off-target-change', 'off-target-still-changed'] if should_track else None
        ok=((status=='tracking' and error<=2*scale and dirty==expected_dirty) if should_track else status!='tracking')
        outputs.append({**meta,'status':status,'rect':box,'kernelMs':ms,'semanticDirty':dirty,'expectedSemanticDirty':expected_dirty,'positionErrorPx':error,'passed':ok})
    return {'case':label,'width':width,'deviceScale':scale,'passed':all(x['passed'] for x in outputs),'requestedFrames':len(labels),'frames':outputs,'seed':seed}

def main():
    with sync_playwright() as pw:
        opts={'headless':True,'args':['--no-sandbox']}
        executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if pathlib.Path('/usr/bin/chromium').exists() else None)
        if executable:opts['executable_path']=executable
        browser=pw.chromium.launch(**opts)
        cases=[]
        configs=[(1024,1),(1440,1),(1920,1),(2560,1),(1440,1.25),(1440,1.5),(1440,2),(1920,2)]
        for width,scale in configs:
            if os.environ.get('TRACKER_CASES') and f'motion-{width}-{scale}' not in os.environ['TRACKER_CASES'].split(','): continue
            page=browser.new_page(viewport={'width':width,'height':900},device_scale_factor=scale)
            actions=[]
            for n in range(20):actions.append((f'scroll{n}',f'editor.scrollTop={480+(n%10)*8}', 'tracking'))
            actions += [('hscroll','editor.scrollLeft=16','tracking'),('hreturn','editor.scrollLeft=0','tracking'),('terminal','terminal.textContent="$ npm test: new terminal output"','tracking'),('offscreen','editor.scrollTop=1450','hidden'),('return','editor.scrollTop=480','tracking')]
            cases.append(run_sequence(page,width,scale,f'motion-{width}-{scale}',actions))
            page.close()
        page=browser.new_page(viewport={'width':1440,'height':900})
        for label,script in [
          ('repeated-context','for(let i=0;i<7;i++)document.querySelector(`#row${38+i} span`).textContent=document.querySelector(`#row${27+i} span`).textContent'),
          ('operator','document.querySelector("#row30 span").textContent="  if (ready && paid) {"'),
          ('surrounding','document.querySelector("#row29 span").textContent="  const paid = true;"'),
          ('filename','identity.textContent="src / other.ts · not the original file"'),
          ('occlusion','const b=document.querySelector("#row30").getBoundingClientRect();cover.style.display="block";cover.style.left=b.x+"px";cover.style.top=b.y+"px"'),
          ('zoom','document.querySelectorAll(".line").forEach(e=>{e.style.fontSize="19px";e.style.lineHeight="28px";e.style.height="28px"})'),
          ('two-pixel-edit','const b=document.querySelector("#row30 span").getBoundingClientRect();cover.style.cssText=`display:block;padding:0;left:${b.x+22}px;top:${b.y+8}px;width:2px;height:2px;background:white`'),
        ]:
            cases.append(run_sequence(page,1440,1,label,[('before','', 'tracking'),(label,script,'hidden')]))
        cases.append(run_sequence(page,1440,1,'off-target-semantics',[
            ('before','','tracking'),
            ('off-target-change','document.querySelector("#row43 span").textContent="  const changed = true;"','tracking'),
            ('off-target-still-changed','','tracking')]))
        # Export a visible actual source screenshot for later overlay playback.
        page.set_content(HTML);page.screenshot(path=str(OUT/'source-1440.png'))
        browser.close()
    values=[f['kernelMs'] for c in cases for f in c.get('frames',[])]
    errors=[f['positionErrorPx'] for c in cases for f in c.get('frames',[]) if f['positionErrorPx'] is not None]
    report={'schema':'screenshot-pixel-benchmark-v2','source':'Chromium-rendered authored coding scenes','trackerInput':'PGM pixels and one initial seed only','actualVisionProvider':False,'nativeCaptureMeasured':False,'cases':cases,'passed':all(c['passed'] for c in cases),'summary':{'cases':len(cases),'seedFailures':sum('seedFailure' in c for c in cases),'requestedFrames':sum(c['requestedFrames'] for c in cases),'evaluatedFrames':len(values),'frames':len(values),'trackedFrames':len(errors),'kernelTimingIncludes':'image matching and aligned semantic comparison only; excludes capture/IPC/render/vision','kernelP50Ms':statistics.median(values) if values else None,'kernelP95Ms':sorted(values)[int(len(values)*.95)] if values else None,'maxPositionErrorPx':max(errors,default=None),'endToEndLatencyMs':None,'wrongTargetCount':sum(1 for c in cases for f in c.get('frames',[]) if f['status']=='tracking' and (f['expected']!='tracking' or f['positionErrorPx']>2*c['deviceScale'])), 'semanticGuardFailures':sum(1 for c in cases for f in c.get('frames',[]) if f['expectedSemanticDirty'] is not None and f['semanticDirty']!=f['expectedSemanticDirty'])}}
    (OUT/'pixel-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['summary'],indent=2));print('FAILED',[c['case'] for c in cases if not c['passed']]);raise SystemExit(0 if report['passed'] else 1)

if __name__ == "__main__":
    main()
