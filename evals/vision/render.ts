import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import type { VisionFixture } from './fixtures'

const require = createRequire(import.meta.url)
const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Fixed geometry and source text. The report records PNG hashes to expose font/rasterizer differences. */
export function fixtureSvg(fixture: VisionFixture): string {
  const view = fixture.screenshot
  const tree = view.tree.map((path, index) => `<text x="22" y="${106 + index * 32}" font-size="18">${xml(path)}</text>`).join('')
  const code = view.rows.map((row, index) => {
    const y = 108 + index * 37
    if (row.fold) return `<rect x="376" y="${y - 23}" width="1178" height="30" fill="#303744"/><text x="395" y="${y}" font-size="19" fill="#9ba7bb">${xml(row.text)}</text>`
    // Obscure the whole right side of this line. The expected answer contains no guessed suffix or placeholder.
    const obscured = row.clipped ? `<rect x="826" y="${y - 25}" width="738" height="34" fill="#687386"/><text x="900" y="${y - 2}" font-size="16" fill="#ffffff">editor tooltip covers this source</text>` : ''
    return `${row.number !== null ? `<text x="366" y="${y}" text-anchor="end" font-size="21" fill="#8d9bb1">${row.number}</text>` : ''}<text x="394" y="${y}" font-size="24" xml:space="preserve">${xml(row.text)}</text>${obscured}`
  }).join('')
  const afterCode = 108 + view.rows.length * 37
  const eof = view.eof ? `<text x="395" y="${afterCode + 8}" font-size="18" fill="#8d9bb1">END OF FILE</text>` : ''
  const requirements = (view.requirements ?? []).map((text, index) => `<text x="394" y="${518 + index * 32}" font-size="21">${xml(text)}</text>`).join('')
  const terminal = (view.terminal ?? []).map((text, index) => `<text x="394" y="${658 + index * 30}" font-size="21">${xml(text)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800" viewBox="0 0 1600 800">
<rect width="1600" height="800" fill="#151b25"/><rect x="0" width="312" height="800" fill="#1e2633"/>
<rect x="312" width="1288" height="58" fill="#273143"/>
<g font-family="DejaVu Sans Mono, monospace" fill="#e5ebf5">
<text x="22" y="39" font-size="18" fill="#aebad0">EXPLORER</text>
${view.breadcrumb ? `<text x="338" y="38" font-size="23">${xml(view.breadcrumb)}</text>` : ''}
${tree}${code}${eof}
${requirements ? '<path d="M312 458H1600" stroke="#415067"/><text x="338" y="488" font-size="17" fill="#aebad0">PROBLEM</text>' + requirements : ''}
${terminal ? '<rect x="312" y="593" width="1288" height="207" fill="#10151d"/><text x="338" y="623" font-size="17" fill="#aebad0">TERMINAL</text>' + terminal : ''}
</g></svg>`
}

export async function renderVisionFixture(fixture: VisionFixture): Promise<{ png: Buffer; sha256: string }> {
  // Next already installs Sharp. Loading from its package works with pnpm's strict layout.
  // The harness deliberately fails if optional dependencies were omitted; it never sends SVG as image/png.
  const fromNext = createRequire(require.resolve('next/package.json'))
  const sharp = fromNext('sharp') as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } }
  const png = await sharp(Buffer.from(fixtureSvg(fixture))).png().toBuffer()
  return { png, sha256: createHash('sha256').update(png).digest('hex') }
}
