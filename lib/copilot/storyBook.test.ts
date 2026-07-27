import { describe, it, expect } from 'vitest'
import { parseStoryBook, looksLikeStoryBook } from './storyBook'

// A tiny two-story book mirroring the real book's structure (section id, story-h
// title, lpline, when, spine). Verifies the parser lifts the selector signal and
// keeps whole-story text — the foundation for question-ranked, spent-once picking.
const BOOK = `<!doctype html><body>
<section id='story-A'><h2 class='story-h'>Story A — Pipeline Rebuild</h2>
<p class='lpline'>Primary: Ownership · Deliver Results</p>
<p class='when'><b>Use when:</b> Biggest project / ownership</p>
<h3 class='sec'>Spine (memorize cold)</h3><ul><li>Rebuilt the settlement pipeline, 8h to 4.5h.</li></ul>
<h3 class='sec'>Hooks</h3><p>Result-first opening...</p>
</section>
<section id='story-X'><h2 class='story-h'>Story X — Migration Disagreement</h2>
<p class='lpline'>Have Backbone; Disagree &amp; Commit</p>
<p class='when'><b>Use when:</b> Disagreement / pushback</p>
<h3 class='sec'>Spine (memorize cold)</h3><ul><li>Pushed back on a direct cutover, insisted on shadow runs.</li></ul>
</section>
</body>`

describe('parseStoryBook', () => {
  it('detects a story book by its section markers', () => {
    expect(looksLikeStoryBook(BOOK)).toBe(true)
    expect(looksLikeStoryBook('just some plain notes\n\nwith paragraphs')).toBe(false)
  })

  it('splits into whole stories with id, title, LPs, use-when', () => {
    const s = parseStoryBook(BOOK)
    expect(s).toHaveLength(2)
    expect(s[0].id).toBe('story-A')
    expect(s[0].title).toContain('Pipeline Rebuild')
    expect(s[1].id).toBe('story-X')
    expect(s[1].lps).toContain('Have Backbone')
    expect(s[1].useWhen).toContain('Disagreement')
  })

  it('builds a retrieval key from selector signal (title + LPs + use-when + spine), not full prose', () => {
    const [a] = parseStoryBook(BOOK)
    // The key carries the "sounds like → pick" signal…
    expect(a.retrievalKey).toContain('Ownership')
    expect(a.retrievalKey).toContain('Biggest project')
    expect(a.retrievalKey).toContain('settlement pipeline') // from spine
    // …and is much shorter than the full answer text.
    expect(a.retrievalKey.length).toBeLessThan(a.fullText.length)
    expect(a.fullText).toContain('Result-first opening')
  })

  it('returns [] for non-book text so plain uploads fall back to chunking', () => {
    expect(parseStoryBook('# Notes\n\nA paragraph.\n\nAnother.')).toEqual([])
  })
})
