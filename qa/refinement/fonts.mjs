// Reuse the actual Next build's self-hosted font faces. Never upload font files
// into a QA artifact; browser screenshots and numeric measurements suffice.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
const path = '.next/static/chunks'
const css = existsSync(path) ? readdirSync(path).filter(name => name.endsWith('.css')).map(name => readFileSync(`${path}/${name}`, 'utf8')).join('\n') : ''
const faces = [...css.matchAll(/@font-face\s*\{[^}]+\}/g)].map(match => match[0]).filter(face => /geist/i.test(face))
function family(variable) {
  return [...css.matchAll(new RegExp(`--${variable}:([^;}]+)`, 'g'))].map(match => match[1]).find(value => /geist/i.test(value))
}
const body = family('font-body'), mono = family('font-code')
if (!faces.length || !body || !mono) {
  if (!process.argv.includes('--allow-fallback')) throw new Error('Build the actual Next application before typography QA; Geist faces are required.')
  writeFileSync('qa/refinement/generated-fonts.css', ':root{--font-body:Arial,sans-serif;--font-code:monospace}/* local fallback only; not font verification */')
} else {
  const output = faces.join('\n').replace(/url\((['"]?)(?:\.\.\/media\/|\/\_next\/static\/media\/)([^)'"?]+)(?:\?[^)'" ]*)?\1\)/g, 'url(/_next/static/media/$2)')
  writeFileSync('qa/refinement/generated-fonts.css', `${output}\n:root{--font-body:${body};--font-code:${mono}}`)
}
