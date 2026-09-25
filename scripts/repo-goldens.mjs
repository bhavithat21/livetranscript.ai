// Generates 24 small, multi-file regression repositories from PUBLIC trusted
// templates. Runs their seeded bugs and reference patches, never AI code. Model
// quality is a separate opt-in benchmark; these results must not be called pass@1.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const languages = ['javascript', 'typescript', 'python', 'java', 'go', 'csharp']
const definitions = [
  { id: 'transition', description: 'Only PROCESSING to SHIPPED is a valid transition.', type: 'string', params: ['current', 'next'], before: "current === 'PROCESSING' || next === 'SHIPPED'", after: "current === 'PROCESSING' && next === 'SHIPPED'", cases: [['PROCESSING', 'SHIPPED', true], ['CANCELLED', 'SHIPPED', false], ['PROCESSING', 'CANCELLED', false], ['CREATED', 'PROCESSING', false]] },
  { id: 'expiry', description: 'An entry is expired at or after its expiry time, including the exact boundary.', type: 'number', params: ['now', 'expires'], before: 'now > expires', after: 'now >= expires', cases: [[10, 10, true], [9, 10, false], [11, 10, true], [0, 0, true]] },
  { id: 'bounds', description: 'A valid zero-based index is nonnegative and strictly less than the item count.', type: 'number', params: ['index', 'count'], before: 'index >= 0 && index <= count', after: 'index >= 0 && index < count', cases: [[0, 0, false], [4, 5, true], [5, 5, false], [-1, 5, false]] },
  { id: 'access', description: 'An owner OR an administrator may access the resource; other users may not.', type: 'boolean', params: ['isOwner', 'isAdmin'], before: 'isOwner && isAdmin', after: 'isOwner || isAdmin', cases: [[true, false, true], [false, true, true], [true, true, true], [false, false, false]] },
]
const arg = process.argv.indexOf('--language'), language = process.argv[arg + 1]
if (arg !== 2 || !languages.includes(language) || process.argv.length !== 4) throw new Error('Usage: node scripts/repo-goldens.mjs --language <javascript|typescript|python|java|go|csharp>')
const output = path.resolve('artifacts/repo-goldens', language)
await mkdir(output, { recursive: true })
const temp = await mkdtemp(path.join(os.tmpdir(), 'lt-goldens-'))
const rows = []
function literal(value, lang) { if (typeof value === 'boolean') return lang === 'python' ? value ? 'True' : 'False' : String(value); return JSON.stringify(value) }
function expression(value, lang) {
  if (lang === 'python') return value.replaceAll('===', '==').replaceAll('&&', 'and').replaceAll('||', 'or')
  if (lang === 'java' && value.includes('PROCESSING')) return value.replace("current === 'PROCESSING'", 'current.equals("PROCESSING")').replace("next === 'SHIPPED'", 'next.equals("SHIPPED")')
  return value.replaceAll('===', lang === 'javascript' || lang === 'typescript' ? '===' : '==').replaceAll("'PROCESSING'", '"PROCESSING"').replaceAll("'SHIPPED'", '"SHIPPED"')
}
function fixture(d, lang, fixed) {
  const expr = expression(fixed ? d.after : d.before, lang), [a, b] = d.params
  const calls = d.cases.map(([x, y, expected]) => [literal(x, lang), literal(y, lang), literal(expected, lang)])
  const requirements = '# Public synthetic repository fixture\n\n' + d.description + '\nPreserve the controller/service interfaces. Correct the smallest responsible expression.\n'
  if (lang === 'javascript') return { 'README.md': requirements, 'service.cjs': `exports.check = (${a}, ${b}) => ${expr}\n`, 'controller.cjs': "const { check } = require('./service.cjs')\nexports.handle = (a, b) => check(a, b)\n", 'check.cjs': "const { handle } = require('./controller.cjs')\n" + calls.map(([x, y, e]) => `if (handle(${x}, ${y}) !== ${e}) throw new Error('assertion failed')`).join('\n') + "\nconsole.log('Tests: 4 passed, 4 total')\n" }
  if (lang === 'typescript') return { 'README.md': requirements, 'service.ts': `export function check(${a}: ${d.type}, ${b}: ${d.type}): boolean { return ${expr} }\n`, 'controller.ts': `import { check } from './service'\nexport function handle(a: ${d.type}, b: ${d.type}) { return check(a, b) }\n`, 'check.ts': "import { handle } from './controller'\n" + calls.map(([x, y, e]) => `if (handle(${x}, ${y}) !== ${e}) throw new Error('assertion failed')`).join('\n') + "\nconsole.log('Tests: 4 passed, 4 total')\n" }
  if (lang === 'python') return { 'README.md': requirements, 'service.py': `def check(${a}, ${b}):\n    return ${expr}\n`, 'controller.py': 'from service import check\ndef handle(a, b):\n    return check(a, b)\n', 'check.py': 'from controller import handle\n' + calls.map(([x, y, e]) => `assert handle(${x}, ${y}) == ${e}`).join('\n') + "\nprint('4 passed')\n" }
  if (lang === 'java') { const type = { string: 'String', number: 'int', boolean: 'boolean' }[d.type]; return { 'README.md': requirements, 'Service.java': `public class Service { public static boolean check(${type} ${a}, ${type} ${b}) { return ${expr}; } }\n`, 'Controller.java': `public class Controller { public static boolean handle(${type} a, ${type} b) { return Service.check(a, b); } }\n`, 'Check.java': 'public class Check { public static void main(String[] args) {\n' + calls.map(([x, y, e]) => `if (Controller.handle(${x}, ${y}) != ${e}) throw new AssertionError("assertion failed");`).join('\n') + '\nSystem.out.println("Tests run: 4, Failures: 0, Errors: 0"); } }\n' } }
  if (lang === 'go') { const type = { string: 'string', number: 'int', boolean: 'bool' }[d.type]; return { 'README.md': requirements, 'go.mod': 'module example.com/ltfixture\n\ngo 1.23.0\n', 'service.go': `package main\nfunc check(${a} ${type}, ${b} ${type}) bool { return ${expr} }\n`, 'controller.go': `package main\nfunc handle(a ${type}, b ${type}) bool { return check(a, b) }\n`, 'main.go': 'package main\nimport "fmt"\nfunc main() {\n' + calls.map(([x, y, e]) => `if handle(${x}, ${y}) != ${e} { panic("assertion failed") }`).join('\n') + '\nfmt.Println("Tests: 4 passed, 4 total")\n}\n' } }
  const type = { string: 'string', number: 'int', boolean: 'bool' }[d.type]
  return { 'README.md': requirements, 'Fixture.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>', 'Service.cs': `public static class Service { public static bool Check(${type} ${a}, ${type} ${b}) { return ${expr}; } }\n`, 'Controller.cs': `public static class Controller { public static bool Handle(${type} a, ${type} b) { return Service.Check(a, b); } }\n`, 'Program.cs': calls.map(([x, y, e]) => `if (Controller.Handle(${x}, ${y}) != ${e}) throw new Exception("assertion failed");`).join('\n') + '\nConsole.WriteLine("Passed! - Failed: 0, Passed: 4");\n' }
}
function run(command, args, cwd, mustPass = true) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 90000, maxBuffer: 1_000_000, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', GOPROXY: 'off' } })
  if (result.error) throw result.error
  if (mustPass && result.status !== 0) throw new Error(`${command} failed: ${result.stderr}\n${result.stdout}`)
  return { status: result.status, stdout: result.stdout.slice(-5000), stderr: result.stderr.slice(-5000) }
}
async function materialize(d, fixed, dir) { const files = fixture(d, language, fixed); await mkdir(dir, { recursive: true }); for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content); return files }
function execute(dir) {
  if (language === 'javascript') return run(process.execPath, ['check.cjs'], dir, false)
  if (language === 'typescript') { const compiler = path.join(process.env.REPO_TYPESCRIPT_ROOT || '', 'node_modules/typescript/bin/tsc'); run(process.execPath, [compiler, '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', 'commonjs', '--outDir', 'build', 'service.ts', 'controller.ts', 'check.ts'], dir); return run(process.execPath, ['build/check.js'], dir, false) }
  if (language === 'python') return run('python3', ['check.py'], dir, false)
  if (language === 'java') { run('javac', ['Service.java', 'Controller.java', 'Check.java'], dir); return run('java', ['Check'], dir, false) }
  if (language === 'go') { run('go', ['build', '-o', 'fixture', '.'], dir); return run('./fixture', [], dir, false) }
  run('dotnet', ['build', '--nologo', '--verbosity', 'quiet', '-o', 'build'], dir)
  return run('dotnet', ['build/Fixture.dll'], dir, false)
}
try {
  for (const d of definitions) {
    const dir = path.join(temp, d.id)
    const baselineFiles = await materialize(d, false, dir)
    const baseline = execute(dir)
    assert.notEqual(baseline.status, 0, `${language}/${d.id}: seeded bug did not fail`)
    const fixedFiles = await materialize(d, true, dir)
    const reference = execute(dir)
    assert.equal(reference.status, 0, `${language}/${d.id}: reference patch failed: ${reference.stderr}`)
    await writeFile(path.join(output, d.id + '.json'), JSON.stringify({ id: `${language}/${d.id}`, purpose: 'public synthetic multi-file regression', requirement: d.description, baselineFiles, referenceFiles: fixedFiles, note: 'Reference files are HELD OUT from model requests. This run used no model.', baseline, reference }, null, 2))
    rows.push({ id: `${language}/${d.id}`, sourceFiles: 3, baselineFailed: true, referencePassed: true, assertions: d.cases.length })
  }
  const report = { language, status: 'passed', actualModelCalls: 0, kind: 'seeded-bug/reference-patch validation, not model pass@1', rows }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally { await rm(temp, { recursive: true, force: true }) }
