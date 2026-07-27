'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

// Markdown renderer for copilot answers (chat + answer feed). Was whitespace-
// pre-wrap, which showed **bold**, ## headings, tables, and lists as literal
// characters — hard to read while hands-free auto-scrolling. react-markdown builds
// React elements (never injects raw HTML), so it's XSS-safe by construction; GFM
// adds tables + task lists. Styled to the app's editorial-glass language (ink
// text, emerald links, tight rhythm) so a streamed answer reads like a designed
// document, not a wall of text.
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  // Pass `start` through so a continuation list ("3. …\n4. …") keeps its real
  // numbers instead of resetting to 1 — the model can emit lists not starting at 1.
  ol: ({ children, start }) => (
    <ol start={start} className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-4 text-base font-semibold text-ink first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-[13px] font-semibold uppercase tracking-wide text-black/55 first:mt-0">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-800 underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-emerald-700/30 pl-3 text-black/70">{children}</blockquote>
  ),
  // Inline vs fenced code. react-markdown v10 drops the `inline` prop. A fenced
  // block has EITHER a language- className OR (for a language-less ``` fence, which
  // gets no className) a trailing newline — true inline code never contains one.
  code: ({ className, children }) => {
    const raw = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : ''
    const isBlock = /language-/.test(className || '') || raw.includes('\n')
    if (isBlock) {
      return (
        <code className={`${className ?? ''} block overflow-x-auto rounded-lg bg-black/[0.04] p-3 font-mono text-xs leading-relaxed`}>
          {children}
        </code>
      )
    }
    return <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-black/10 bg-black/[0.03] px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-black/10 px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-black/10" />,
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
