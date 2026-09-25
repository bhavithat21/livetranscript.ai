import { createRoot } from 'react-dom/client'
import { RepositoryCoach } from '@/components/coach/RepositoryCoach'
import type { CoachController, CoachTransport } from '@/lib/coach/controller'
import type { CoachState, Observation } from '@/lib/coach/types'
import { parseGuidance } from '@/lib/coach/validation'
import './qa.css'
const path = 'src/services/TrackingService.ts'
const before = '  return current === "PROCESSING" || next === "SHIPPED";'
const after = '  return current === "PROCESSING" && next === "SHIPPED";'
const source = (correct = false, name = path): Observation => ({
  files: [{ path: name, language: 'typescript', startLine: 1, lines: ['export function accepts(current: string, next: string) {', correct ? after : before, '}'], confidence: 1, endOfFile: true }],
  visiblePaths: [path, 'src/controllers/OrderController.ts', 'tests/TrackingService.test.ts'], terminal: '', requirements: ['Only PROCESSING orders may become SHIPPED. Keep public API unchanged.'],
})
let controller: CoachController
const calls: string[] = []
const transport: CoachTransport = async (lane, context, { delta, signal }) => {
  calls.push(lane)
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 60); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Fixture cancelled')) }, { once: true }) })
  if (lane === 'talk') {
    delta('The transition must require both the current state and the requested next state. I would inspect the service condition, then verify that cancelled orders remain rejected.', 'fixture-talk-NOT-a-model')
    return { model: 'fixture-talk-NOT-a-model', guidance: null }
  }
  const file = context.files.find(file => file.path === path)
  const knownBefore = file?.fragments.some(part => part.lines.includes(before))
  return { model: 'fixture-guide-NOT-a-model', guidance: parseGuidance({
    summary: knownBefore ? 'The observed OR condition admits either side of the transition. Require both sides and verify the invalid transitions.' : 'The displayed edit should be reviewed against the targeted tests. No test has been run by this coach.',
    look: [{ path: 'tests/TrackingService.test.ts', startLine: null, endLine: null, symbol: '', reason: 'Inspect the cancelled-order assertion before treating this proposal as complete.' }],
    patches: knownBefore ? [{ path, fileVersion: file!.fileVersion, startLine: 2, before, after, reason: 'Both the origin and destination must satisfy the transition contract.' }] : [],
    findings: [], hypotheses: [], verify: [{ command: 'npm test', scope: 'TrackingService transition tests', reason: 'Check the allowed transition and rejected states.' }],
  }, context) }
}
declare global { interface Window { __coachQA: { snapshot: () => CoachState; calls: () => string[]; observe: (correct: boolean, name?: string) => void; question: (question: string) => void; output: (output: string) => void; exportReplay: () => string } } }
function ready(resources: { controller: CoachController }) {
  controller = resources.controller
  controller.start('practice', 'Fix order status transitions without changing the public API.')
  controller.observe(source()); controller.question('Why is the shipment status test failing, and which change should we make?')
  window.__coachQA = { snapshot: () => controller.getSnapshot(), calls: () => [...calls], observe: (correct, name) => controller.observe(source(correct, name)), question: question => controller.question(question), output: output => controller.observe({ files: [], visiblePaths: [], requirements: [], terminal: output }), exportReplay: () => controller.exportReplay() }
}
createRoot(document.getElementById('root')!).render(<main className="qa-shell"><p className="qa-banner">Isolated browser QA · synthetic code and response fixtures · no provider calls</p><RepositoryCoach transport={transport} onReady={ready} /></main>)
