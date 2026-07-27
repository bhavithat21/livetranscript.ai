#!/usr/bin/env node
// Publish desktop updater artifacts to a PUBLIC store (Vercel Blob) and rewrite
// latest.json so the app fetches everything through the stable, private-repo-safe
// front door: https://livetranscript.ai/updates/<file> (see app/updates/[...path]).
//
// Why this exists: tauri-action writes GitHub-release URLs into latest.json. If the
// repo goes private those URLs 404 for the unauthenticated updater. Instead we:
//   1. upload each installer + its .sig to Blob,
//   2. rewrite every platform's `url` in latest.json to /updates/<installer name>,
//   3. upload the rewritten latest.json to Blob at a stable key,
// so /updates/latest.json → Blob latest.json → /updates/<installer> → Blob binary.
// Nothing in the shipped app ever points at GitHub or a rotating Blob URL.
//
// Run in CI AFTER tauri-action builds, with BLOB_READ_WRITE_TOKEN set. Usage:
//   node scripts/publish-updates.mjs <dir-containing-latest.json-and-bundles>
//
// Env:
//   BLOB_READ_WRITE_TOKEN  – Vercel Blob RW token (repo secret)
//   UPDATES_PUBLIC_BASE    – public base the app redirects to; MUST equal the
//                            UPDATES_BASE_URL env set on the web app. Default:
//                            https://livetranscript.ai/updates (self-referential is
//                            fine — the route redirects to the Blob base instead;
//                            see note below).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { put } from '@vercel/blob'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: publish-updates.mjs <artifacts-dir>')
  process.exit(1)
}

const token = process.env.BLOB_READ_WRITE_TOKEN
if (!token) {
  console.error('BLOB_READ_WRITE_TOKEN not set — cannot publish updates')
  process.exit(1)
}

// The stable front door baked into the app. Installer URLs in latest.json are
// rewritten to `${FRONT_DOOR}/<file>`, which app/updates/[...path] redirects to
// the Blob copy. So the app only ever hits our own domain.
const FRONT_DOOR = (process.env.UPDATES_PUBLIC_BASE || 'https://livetranscript.ai/updates').replace(/\/$/, '')

// Find latest.json anywhere under the artifacts dir.
function findFile(root, name) {
  for (const entry of readdirSync(root)) {
    const p = join(root, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      const found = findFile(p, name)
      if (found) return found
    } else if (entry === name) {
      return p
    }
  }
  return null
}

const manifestPath = findFile(dir, 'latest.json')
if (!manifestPath) {
  console.error(`No latest.json found under ${dir}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// Upload one file to Blob at updates/<filename> (public, stable path) and return
// the front-door URL the app should use.
async function upload(filePath) {
  const name = basename(filePath)
  const body = readFileSync(filePath)
  const key = `updates/${name}`
  await put(key, body, { access: 'public', token, addRandomSuffix: false, allowOverwrite: true })
  console.log(`uploaded ${key}`)
  return `${FRONT_DOOR}/${name}`
}

// Each platform entry has { signature, url }. The url points at the installer
// (GitHub); re-upload that installer to Blob and rewrite the url to the front door.
// A missing installer would ship a manifest whose download 404s, so treat it as a
// hard error rather than silently skipping (which would look green but be broken).
const platforms = manifest.platforms ?? {}
if (Object.keys(platforms).length === 0) {
  console.error('latest.json has no platforms — nothing to publish (bad manifest)')
  process.exit(1)
}
const failures = []
for (const [plat, entry] of Object.entries(platforms)) {
  if (!entry || typeof entry.url !== 'string') {
    failures.push(`${plat}: manifest entry missing a url`)
    continue
  }
  let installerName
  try {
    installerName = decodeURIComponent(basename(new URL(entry.url).pathname))
  } catch {
    failures.push(`${plat}: unparseable url ${entry.url}`)
    continue
  }
  const localInstaller = findFile(dir, installerName)
  if (!localInstaller) {
    failures.push(`${plat}: installer ${installerName} not found in ${dir}`)
    continue
  }
  entry.url = await upload(localInstaller) // signature field is left untouched
}
if (failures.length) {
  console.error('Publish failed:\n  ' + failures.join('\n  '))
  process.exit(1)
}

// Upload the rewritten manifest last, at the stable key the app polls.
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
await upload(manifestPath)

console.log('Published updates. App fetches via', `${FRONT_DOOR}/latest.json`)
