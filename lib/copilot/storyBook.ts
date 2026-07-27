// Story-book parser for behavioral mode. A candidate uploads a structured "story
// book" (like Bhavitha's SDE-II book): N stories, each mapped to Leadership
// Principles with a "use when" trigger, a memorizable spine, hooks, a full STAR
// answer, metric defense, and follow-ups. The generic per-paragraph RAG in
// useModeContext throws that structure away — it returns ONE best paragraph, not a
// whole story, and can't honor the book's core rule: pick the story that fits the
// QUESTION, and spend each story ONCE per round.
//
// This parser splits the book into whole STORIES and builds, per story, a compact
// RETRIEVAL KEY (title + LPs + "use when" trigger + spine) — which is exactly the
// book's own "if the question sounds like… → pick this story" selector. The
// behavioral flow embeds that key, ranks stories against the heard question, and
// returns the top unspent one(s).

export type ParsedStory = {
  id: string // stable id from the section (e.g. "story-A") or a slug
  title: string // "Story A — PPL Settlement Pipeline Rebuild"
  lps: string // the Leadership Principles line, if present
  useWhen: string // the "use when" trigger line, if present
  retrievalKey: string // title + lps + useWhen + spine — what we embed to match a question
  fullText: string // the whole story, plain text — what we feed the model to answer
}

// Strip tags to text, decode the handful of entities the book uses, collapse space.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Is this raw text an HTML story book? We only take the structured path when the
// book's section markers are present; otherwise the caller falls back to plain
// chunking so ordinary .txt/.md uploads still work.
export function looksLikeStoryBook(raw: string): boolean {
  return /<section[^>]*id=['"]story-/i.test(raw)
}

// Pull the first non-empty text line matching a labeled paragraph (e.g. the LP line
// or the "use when" line) out of a story's HTML fragment.
function firstMatch(fragment: string, re: RegExp): string {
  const m = fragment.match(re)
  return m ? htmlToText(m[0]).replace(/^[^:]*:\s*/, '').replace(/\s+/g, ' ').trim() : ''
}

// Parse an HTML story book into whole stories. Each <section id="story-*"> is one
// story; we lift its title, LP line, "use when" line, and spine for the retrieval
// key, and keep the whole section text as the answer material. Returns [] if the
// text isn't a recognizable book (caller falls back to plain chunking).
export function parseStoryBook(raw: string): ParsedStory[] {
  if (!looksLikeStoryBook(raw)) return []
  const stories: ParsedStory[] = []
  // Split on each story section open tag, keeping the id. Non-greedy up to the next
  // section or end — the book nests sub-elements but not sub-sections.
  const sectionRe = /<section[^>]*id=['"](story-[^'"]+)['"][^>]*>([\s\S]*?)(?=<section[^>]*id=['"]story-|<\/body>|$)/gi
  let m: RegExpExecArray | null
  while ((m = sectionRe.exec(raw)) !== null) {
    const id = m[1]
    const fragment = m[2]
    // Title: the story header (class 'story-h' in the book, else first heading).
    const titleRaw =
      fragment.match(/<h2[^>]*class=['"][^'"]*story-h[^'"]*['"][^>]*>([\s\S]*?)<\/h2>/i) ||
      fragment.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
    const title = titleRaw ? htmlToText(titleRaw[1]) : id
    // LP line (class 'lpline') and "use when" line (class 'when').
    const lps = firstMatch(fragment, /<p[^>]*class=['"][^'"]*lpline[^'"]*['"][^>]*>[\s\S]*?<\/p>/i)
    const useWhen = firstMatch(fragment, /<p[^>]*class=['"][^'"]*when[^'"]*['"][^>]*>[\s\S]*?<\/p>/i)
    // Spine: the "Spine (memorize cold)" section's list — the compact fact set. Falls
    // back to the first ~600 chars of body text if the book has no explicit spine.
    const spineMatch = fragment.match(/spine[^<]*<\/h3>([\s\S]*?)(?=<h3|$)/i)
    const spine = spineMatch ? htmlToText(spineMatch[1]).slice(0, 800) : ''
    const fullText = htmlToText(fragment)
    if (!fullText || fullText.length < 40) continue // skip an empty/degenerate section
    // The retrieval key is the SELECTOR signal: what the story is about + when to use
    // it, NOT its full prose — matches the book's own "sounds like → pick" table.
    const retrievalKey = [title, lps, useWhen, spine].filter(Boolean).join('. ')
    stories.push({ id, title, lps, useWhen, retrievalKey, fullText })
  }
  return stories
}
