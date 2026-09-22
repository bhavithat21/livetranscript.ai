#!/usr/bin/env node
/** Create an isolated branding overlay. Never rewrite the signed bundle/config. */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const controlCharacters = new RegExp('[\\u0000-\\u001F\\u007F]')

export function validateProductName(raw) {
  const name = raw.trim()
  if (!name || name.length > 40 || controlCharacters.test(name) || /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) {
    throw new Error('Use 1–40 characters without file-path characters or reserved Windows names.')
  }
  return name
}

export function brandingOverlay(base, productName, iconDirectory) {
  const isMain = (window) => (window.label ?? 'main') === 'main'
  if (!Array.isArray(base.app?.windows) || !base.app.windows.some(isMain)) {
    throw new Error('The base desktop configuration must contain the main window.')
  }
  const overlay = {
    productName: validateProductName(productName),
    app: { windows: base.app.windows.map((window) => isMain(window) ? { ...window, title: productName.trim() } : { ...window }) },
  }
  if (iconDirectory) {
    overlay.bundle = { icon: ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico'].map((file) => join(iconDirectory, file)) }
  }
  // identifier, executable name, updater endpoint/key and signing are inherited.
  return overlay
}

function validateSourcePng(bytes) {
  if (bytes.length < 24 || bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('The installer icon must be a PNG smaller than 10 MB.')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width !== height || width < 256 || width > 4096) throw new Error('Use a square PNG between 256 and 4096 pixels. 1024 pixels is recommended.')
}

export async function prepareBranding({ name, icon, out, basePath = join(root, 'src-tauri', 'tauri.conf.json') }) {
  const productName = validateProductName(name)
  const base = JSON.parse(await readFile(basePath, 'utf8'))
  const outputDirectory = resolve(out || join(tmpdir(), 'livetranscript-branding'))
  const iconDirectory = icon ? join(outputDirectory, 'icons') : undefined
  // Read and validate every input before creating any output files.
  if (icon) validateSourcePng(await readFile(resolve(icon)))
  const overlay = brandingOverlay(base, productName, iconDirectory)
  await mkdir(dirname(outputDirectory), { recursive: true })
  // Reserve a new output directory before copying any assets; an existing
  // variant must never be partially overwritten by a failed second invocation.
  await mkdir(outputDirectory)
  const sourcePath = icon ? join(outputDirectory, 'source.png') : undefined
  if (icon && resolve(icon) !== sourcePath) await copyFile(resolve(icon), sourcePath)
  const configPath = join(outputDirectory, 'tauri.branding.conf.json')
  await writeFile(configPath, `${JSON.stringify(overlay, null, 2)}\n`, { flag: 'wx' })
  return { configPath, sourcePath, iconDirectory }
}

async function main() {
  const options = {}
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].slice(2)
    if (!['name', 'icon', 'out'].includes(key) || !args[index].startsWith('--') || !args[index + 1]) {
      throw new Error('Usage: node scripts/brand-desktop.mjs --name "My workspace" [--icon /path/icon.png] [--out /path/new-directory]')
    }
    options[key] = args[index + 1]
  }
  if (!options.name) throw new Error('Provide --name "My workspace".')
  const result = await prepareBranding(options)
  console.log(JSON.stringify(result, null, 2))
  console.log('Branding overlay prepared. Generate the icon set before building if sourcePath is present. See docs/desktop-appearance.md.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
