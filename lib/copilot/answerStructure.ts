// Split a copilot answer into three reading tiers so the UI can express the answer's
// STRUCTURE, not render a flat wall of text — the thing a candidate needs when they
// glance for one second mid-sentence:
//   - lede    : the say-this-now opener (first meaningful line/sentence)
//   - body    : the supporting script, read aloud after the lede
//   - reserve : DO-NOT-say-aloud material (glossary, likely follow-ups, metric
//               defense, edge cases) — held in a drawer, surfaced only if probed
//
// The prompts already emit this shape (lede-first per GROUNDING; behavioral has
// Glossary / Likely follow-ups / Metric defense marked "reference only, do not say
// aloud"; coding has EDGE CASES). We detect the reserve headings and peel the lede
// off the front. Best-effort + streaming-safe: a partial answer still splits, and an
// answer with no recognizable structure returns all-body (never loses text).

export type AnswerParts = { lede: string; body: string; reserve: string }

// Headings that begin the "do not say aloud" reserve. Matched at the start of a line,
// optionally wrapped in markdown bold/heading marks. Kept broad but anchored so a
// mention mid-sentence ("check the edge cases") doesn't trigger a split.
const RESERVE_HEADING =
  /^\s*(?:#{1,4}\s*|\*\*)?\s*(?:\d+\.\s*)?(glossary|likely follow-?ups?|follow-?ups?|metric defense|edge cases|reference only|do not say)\b/i

// A markdown heading/label line (used to find where the lede ends if there's no
// blank line — e.g. the lede is immediately followed by "**Approach**").
const HEADING_LINE = /^\s*(?:#{1,4}\s|>\s|\*\*[^*]+\*\*\s*:?\s*$|[A-Z][A-Za-z ]{0,30}:\s*$)/

// Find the first line index that starts the reserve section, or -1.
function reserveStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (RESERVE_HEADING.test(lines[i])) return i
  }
  return -1
}

export function splitAnswer(raw: string): AnswerParts {
  const text = raw ?? ''
  if (!text.trim()) return { lede: '', body: '', reserve: '' }

  const lines = text.split('\n')
  const rs = reserveStart(lines)
  const reserve = rs >= 0 ? lines.slice(rs).join('\n').trim() : ''
  const mainLines = rs >= 0 ? lines.slice(0, rs) : lines
  const main = mainLines.join('\n')

  // Lede = the first non-empty block: either the first sentence-ish opener, or up to
  // the first blank line / first heading after it, whichever comes first. We keep it
  // short (one glanceable line) — the hero is the say-this-now line, not a paragraph.
  let lede = ''
  let bodyStart = 0
  for (let i = 0; i < mainLines.length; i++) {
    const line = mainLines[i]
    if (!line.trim()) { bodyStart = i + 1; continue } // skip leading blanks
    // Strip a leading markdown heading/blockquote/bold marker off the lede line.
    lede = line.replace(/^\s*(?:#{1,4}\s*|>\s*)/, '').trim()
    bodyStart = i + 1
    break
  }
  const body = mainLines.slice(bodyStart).join('\n').trim()

  return { lede, body, reserve }
}
