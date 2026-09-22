/* Dependency-light smoke checks: node --test scripts/test-interview-core.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const load = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'interview-core-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
execFileSync(process.execPath, [load.resolve('typescript/bin/tsc'), '--strict', '--target', 'es2023', '--module', 'commonjs', '--lib', 'es2023,dom', '--outDir', out,
  join(root, 'lib/interview/model.ts'), join(root, 'lib/interview/prompts.ts'), join(root, 'lib/interview/readBody.ts')])
const m = load(join(out, 'model.js'))
const { readInterviewBody } = load(join(out, 'readBody.js'))
const turns = [
  { id: 'q1', role: 'interviewer', source: 'mock', atMs: 0, text: 'Tell me about an incident.' },
  { id: 'a1', role: 'candidate', source: 'typed', atMs: 1000, text: 'I rolled back the failing change and verified the queue drained.' },
]
const request = { action: 'feedback', mode: 'mock', settings: m.DEFAULT_SETTINGS, turns }
const evidence = [{ turnId: 'a1', quote: 'I rolled back the failing change' }]
const raw = { overview: 'Captured actions reviewed.', dimensions: [
  { key: 'relevance', score: 4, reason: 'Relevant', evidence }, { key: 'ownership', score: 3, reason: 'Concrete action', evidence },
], questions: [], nextSteps: [] }
test('valid request preserves candidate attribution', () => assert.equal(m.parseInterviewRequest(request).turns[1].role, 'candidate'))
test('candidate answers are required', () => assert.throws(() => m.parseInterviewRequest({ ...request, turns: [turns[0]] }), /candidate answer/))
test('duplicate IDs are rejected', () => assert.throws(() => m.parseInterviewRequest({ ...request, turns: [turns[1], turns[1]] }), /unique/))
test('unanswered questions cannot advance', () => assert.throws(() => m.parseInterviewRequest({ ...request, action: 'question', turns: [turns[0]] }), /Answer the current/))
test('question limit is enforced', () => assert.throws(() => m.parseInterviewRequest({ ...request, action: 'question', settings: { ...m.DEFAULT_SETTINGS, questionCount: 1 } }), /limit/))
test('actual candidate quotes are accepted', () => assert.deepEqual(m.verifiedEvidence(evidence, turns), evidence))
test('invented and interviewer quotes are excluded', () => assert.deepEqual(m.verifiedEvidence([{ turnId: 'q1', quote: turns[0].text }, { turnId: 'a1', quote: 'I earned a billion dollars' }], turns), []))
test('overall is derived from supported dimensions', () => assert.equal(m.normalizeFeedback({ ...raw, overall: 100 }, turns).overall, 3.5))
test('missing dimensions are unscored, not zero', () => assert.equal(m.normalizeFeedback(raw, turns).dimensions.find((d) => d.key === 'technicalDepth').score, null))
test('unsupported scores cannot create an overall', () => assert.equal(m.normalizeFeedback({ ...raw, dimensions: [{ key: 'relevance', score: 5, reason: 'R', evidence: [] }] }, turns).overall, null))
test('repeated questions are rejected', () => assert.throws(() => m.parseMockQuestion({ question: turns[0].text }, turns), /repeated/))
test('report export includes uncertainty', () => assert.match(m.reportMarkdown(m.normalizeFeedback(raw, turns), turns), /not a hiring prediction/))
test('saved speaker names are explicit', () => assert.deepEqual(m.savedSegments(turns).map((t) => t.name), ['Interviewer', 'Candidate']))
test('byte-bounded reader accepts valid Unicode JSON', async () => assert.deepEqual(await readInterviewBody(new Request('https://test.local', { method: 'POST', body: '{"text":"Résumé — 你好"}' })), { text: 'Résumé — 你好' }))
test('byte-bounded reader rejects invalid JSON', async () => assert.rejects(readInterviewBody(new Request('https://test.local', { method: 'POST', body: 'broken' })), /Invalid JSON/))
test('byte-bounded reader rejects oversized undeclared bodies', async () => assert.rejects(readInterviewBody(new Request('https://test.local', { method: 'POST', body: 'x'.repeat(m.MAX_BODY_BYTES + 1) })), /too large/))
