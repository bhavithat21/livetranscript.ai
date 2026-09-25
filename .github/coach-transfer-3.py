# Applies the reviewed local changes only to their exact source preimages.
# Temporary build transfer; not part of the application or final feature branch.
from pathlib import Path
import hashlib, os
ROOT = Path(os.environ['TARGET_ROOT']).resolve()
def put(name, old_hash, new_hash, operations):
    path = ROOT / name
    assert path.resolve().is_relative_to(ROOT), 'Invalid target path'
    old = path.read_bytes() if path.exists() else None
    assert (hashlib.sha256(old).hexdigest() if old is not None else None) == old_hash, 'Source mismatch: ' + name
    lines = (old.decode() if old is not None else '').splitlines(keepends=True)
    for start, end, content in reversed(operations):
        lines[start:end] = content.splitlines(keepends=True)
    data = ''.join(lines).encode()
    assert hashlib.sha256(data).hexdigest() == new_hash, 'Transfer mismatch: ' + name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(name, new_hash)

put('lib/coach/types.ts', '77e5902d12c15400cd52ea7c96fcd5f2dadecb016e8d82109c27e866ffe5ab77', 'a0ffd1134a295fe5363c740ac8ffd90c843146f6954952d8344d487e519de511', [
    (70, 70, r"""  visibleView: { origin: Origin; files: Array<{ path: string; startLine: number | null; endLine: number | null }>; terminalVisible: boolean } | null
"""),
])
put('lib/coach/validation.ts', 'fbb07cfa732386b3708265661f08b18304b7147a8f5117242e3d8b121a7ef9e2', 'c9b050f6dc724eeac885ae50b2fcb954e0771e85c42a86d9c2970ddb01b0b592', [
    (104, 104, r"""    if (/\[REDACTED(?: SECRET)?\]/.test(before + after)) throw new Error('Redacted source cannot support an exact patch')
"""),
])
put('qa/coach/adapters/link.tsx', None, '0ba3a1a48b2628f2bf1e92cbb502133648c048e30d823dd9f2e765dd5a4307ca', [
    (0, 0, r"""import type { AnchorHTMLAttributes } from 'react'
/** Only routing is substituted; production shell markup and styles are rendered. */
export default function QALink(props: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} /> }
"""),
])
put('qa/coach/adapters/recorder.ts', None, '29f6ecf74130282fd595fcd00e48d79902109b90eff20b230e0a06a5aeceef7b', [
    (0, 0, r"""import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapturedSegment, CapturePhase } from '../../../lib/interview/useInterviewRecorder'
export { liveTranscript, captureText } from '../../../lib/interview/useInterviewRecorder'
const listeners = new Set<(text: string, source: string) => void>()
export function injectSpeech(text: string, source = 'system') { listeners.forEach(listener => listener(text, source)) }
/** Explicit ASR/device fixture. Does not request a microphone or call an ASR service. */
export function useInterviewRecorder() {
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [segments, setSegments] = useState<CapturedSegment[]>([])
  const rows = useRef<CapturedSegment[]>([]), active = useRef(false), input = useRef('')
  useEffect(() => {
    const update = (text: string, source: string) => {
      if (!active.current || input.current !== source) return
      const row: CapturedSegment = { id: rows.current.length + 1, text, capturedAt: Date.now(), speaker: 0, isFinal: true }
      rows.current = [...rows.current, row]; setSegments(rows.current)
    }
    listeners.add(update)
    return () => { active.current = false; listeners.delete(update) }
  }, [])
  const start = useCallback(async (source: string) => { input.current = source; active.current = true; rows.current = []; setSegments([]); setPhase('recording') }, [])
  const stop = useCallback(async () => { active.current = false; setPhase('idle'); return rows.current.slice() }, [])
  const getSegments = useCallback(() => rows.current.slice(), [])
  return { start, stop, getSegments, segments, phase, error: null, level: 0 }
}
"""),
])
put('qa/coach/bundle.mjs', None, '0ae1cdb50dd32821966c0c7dc7defa4dd95293dd8334c38b9b63bba74dfb3090', [
    (0, 0, r"""// Optional offline browser-QA bundles: no network navigation or provider access.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = await import(pathToFileURL(fromVitest.resolve('vite')).href)
for (const entry of ['index', 'live']) await build({ configFile: 'qa/coach/vite.config.ts', base: './', build: { outDir: resolve(`qa-results/coach-bundles/${entry}`), emptyOutDir: true, cssCodeSplit: false, minify: false, rollupOptions: { input: resolve(`qa/coach/${entry}.html`), output: { inlineDynamicImports: true } } } })
"""),
])
put('qa/coach/live.html', None, 'd809931fd821ef983123507eeb6603188d8ff607bc6c246453203e33ca3ee8cf', [
    (0, 0, r"""<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Integrated Live interview — fixture QA</title></head><body><div id="root"></div><script type="module" src="/live.tsx"></script></body></html>
"""),
])
put('qa/coach/live.tsx', None, '9c30681df9f566cfcb61c19228b0c981c433094d7af8bfe62b5bf41da4754a94', [
    (0, 0, r"""import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { LiveInterview } from '@/components/interview/LiveInterview'
import { InterviewTuningProvider } from '@/lib/interview/TuningContext'
import { injectSpeech } from './adapters/recorder'
import { parseContext } from '@/lib/coach/context'
import { parseGuidance } from '@/lib/coach/validation'
import type { ContextPacket, Observation } from '@/lib/coach/types'
import '@/app/globals.css'
const path = 'src/services/TrackingService.ts'
const before = '  return current === "PROCESSING" || next === "SHIPPED";'
const after = '  return current === "PROCESSING" && next === "SHIPPED";'
const source: Observation = {
  files: [{ path, language: 'typescript', startLine: 1, lines: ['export function accepts(current: string, next: string) {', before, '}'], confidence: 1, endOfFile: true }],
  visiblePaths: [path, 'tests/TrackingService.test.ts'], terminal: '', requirements: ['Only PROCESSING orders may become SHIPPED. Preserve the public API.'],
}
const calls: Array<{ lane: string; context: ContextPacket }> = []
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === '/api/copilot/repo-screen') return Response.json({ observation: source, model: 'fixture-vision-NOT-a-model' })
  if (url === '/api/copilot/coach') {
    const body = JSON.parse(String(init?.body)), context = parseContext(body.context)
    calls.push({ lane: body.lane, context })
    if (init?.signal?.aborted) throw new DOMException('Fixture cancelled', 'AbortError')
    let messages: object[]
    if (body.lane === 'talk') messages = [
      { type: 'delta', text: 'I would trace the status transition in the service, check that both sides of the condition are required, then verify the rejected states.', model: 'fixture-talk-NOT-a-model' },
      { type: 'done', model: 'fixture-talk-NOT-a-model', guidance: null },
    ]
    else {
      const file = context.files.find(file => file.path === path)
      const guidance = parseGuidance({ summary: 'Require both sides of the observed transition contract.', look: [{ path: 'tests/TrackingService.test.ts', startLine: null, endLine: null, symbol: '', reason: 'Inspect rejected-state assertions.' }], patches: file ? [{ path, fileVersion: file.fileVersion, startLine: 2, before, after, reason: 'Both origin and destination must match.' }] : [], findings: [], hypotheses: [], verify: [] }, context)
      messages = [{ type: 'done', guidance, model: 'fixture-guide-NOT-a-model' }]
    }
    return new Response(messages.map(message => JSON.stringify(message)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
  }
  // Vite module/HMR assets may use fetch; no product/API provider calls are allowed.
  if (url.includes('/api/') || /^https?:/.test(url)) throw new Error(`Unexpected live QA network request: ${url}`)
  return originalFetch(input, init)
}
declare global { interface Window { __liveQA: { speak: (text: string, source?: string) => void; calls: () => Array<{ lane: string; context: ContextPacket }> } } }
window.__liveQA = { speak: injectSpeech, calls: () => [...calls] }
function App() {
  const [completed, setCompleted] = useState(false)
  return <InterviewTuningProvider ownerId="fixture-account"><WorkspaceShell active="interview"><main style={{ padding: 'clamp(12px, 2vw, 28px)', minWidth: 0 }}><p style={{ fontSize: 12, marginBottom: 16 }}>Integrated Live UI QA · synthetic audio, screen extraction, and model responses · no provider calls</p>{completed && <p role="status">Fixture transcript completed</p>}<LiveInterview visible blocked={false} onActivity={() => {}} onComplete={() => setCompleted(true)} /></main></WorkspaceShell></InterviewTuningProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
"""),
])
put('qa/coach/verify.py', '853a23351d54aeeb0a82f7ef1b16b42c4d0b880d563e601ccd66faf6dc844e58', '2d7086608d5944757b648851ea494ca3a6be79763d684b18464018d2abf1a6e1', [
    (2, 2, r"""import os
"""),
    (7, 8, r"""report = {'kind': 'real-browser-fixture-qa', 'providerInference': False, 'offlineBundle': bool(os.environ.get('COACH_OFFLINE_BUNDLES')), 'viewports': [], 'checks': []}
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

"""),
    (9, 10, r"""    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
"""),
    (13, 14, r"""    open_fixture(page)
"""),
    (60, 60, r'''    # Render the REAL navigation shell + LiveInterview + RepositoryCoach together.
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
    live.get_by_role('button', name='End', exact=True).click()
    live.get_by_role('button', name='Start interview', exact=True).wait_for()
    assert live.get_by_test_id('repository-coach').count() == 0
    report['checks'].append('Integrated Live mounts the coach after consent, grounds a screenshot, pauses, and unmounts on End')
    assert not errors, f'Browser exceptions: {errors}'
'''),
])
put('qa/coach/vite.config.ts', 'df7d9ee09c7a1edccbdcce2bb74f9d9ea2910803499706e146286c3597072218', '2613132b634594e5121aed805e952c2e5f12d1501e9091da411c27fe6681ee20', [
    (5, 6, r"""  resolve: { alias: { '@/lib/interview/useInterviewRecorder': fileURLToPath(new URL('./adapters/recorder.ts', import.meta.url)), 'next/link': fileURLToPath(new URL('./adapters/link.tsx', import.meta.url)), '@': fileURLToPath(new URL('../..', import.meta.url)) } },
"""),
])
