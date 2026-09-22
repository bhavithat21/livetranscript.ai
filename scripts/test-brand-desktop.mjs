import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandingOverlay, prepareBranding, validateProductName } from './brand-desktop.mjs'

test('branding changes display name/title/icons while preserving main window behavior and signed identity', () => {
  const base = { identifier: 'ai.livetranscript.desktop', plugins: { updater: { pubkey: 'public-key', endpoints: ['https://livetranscript.ai/updates/latest.json'] } }, app: { windows: [{ label: 'main', title: 'LiveTranscript', width: 1200, contentProtected: true }, { label: 'secondary', title: 'Other' }] } }
  const before = JSON.stringify(base)
  const overlay = brandingOverlay(base, 'My workspace', '/tmp/icons')
  assert.equal(overlay.productName, 'My workspace')
  assert.equal(overlay.app.windows[0].title, 'My workspace')
  assert.equal(overlay.app.windows[0].contentProtected, true)
  assert.equal(overlay.app.windows[0].width, 1200)
  assert.equal(overlay.app.windows[1].title, 'Other')
  assert.equal(overlay.identifier, undefined)
  assert.equal(overlay.plugins, undefined)
  assert.equal(overlay.bundle.icon.length, 5)
  assert.equal(JSON.stringify(base), before)
})

test('invalid installer names cannot become file paths or reserved Windows names', () => {
  for (const name of ['', '../escape', 'C:\\path', 'CON', 'nul.exe', 'bad?', 'space.', 'a'.repeat(41)]) {
    assert.throws(() => validateProductName(name))
  }
  assert.equal(validateProductName(' My workspace '), 'My workspace')
})

test('writes a separate overlay without touching the base and refuses overwriting an existing overlay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lt-branding-test-'))
  try {
    const basePath = join(directory, 'base.json')
    const original = JSON.stringify({ identifier: 'ai.livetranscript.desktop', app: { windows: [{ label: 'main', title: 'LiveTranscript', transparent: true }] } })
    await writeFile(basePath, original)
    const result = await prepareBranding({ name: 'Workspace', out: join(directory, 'branding'), basePath })
    assert.equal((JSON.parse(await readFile(result.configPath, 'utf8'))).productName, 'Workspace')
    assert.equal(await readFile(basePath, 'utf8'), original)
    await assert.rejects(prepareBranding({ name: 'Different', out: join(directory, 'branding'), basePath }), /EEXIST/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('prepares an overlay against the real desktop config, including its implicit main label', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lt-branding-real-'))
  try {
    const result = await prepareBranding({ name: 'Repository workspace', out: join(directory, 'branding') })
    const config = JSON.parse(await readFile(result.configPath, 'utf8'))
    assert.equal(config.app.windows[0].title, 'Repository workspace')
    assert.equal(config.app.windows[0].contentProtected, true)
    assert.equal(config.app.windows[0].minWidth, 380)
    assert.equal(config.identifier, undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
