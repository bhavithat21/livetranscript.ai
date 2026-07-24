'use client'
import { useAppIdentity, DEFAULT_APP_NAME } from '@/lib/appIdentity/useAppIdentity'

// The app wordmark, honoring the user's custom app name (useAppIdentity). At the
// default name we keep the branded "Live" + emerald "Transcript" split; a custom
// name renders plainly with the accent on its trailing part so it still feels
// like a logo. Same component on web + Mac + Windows (desktop loads the web app).
export function Wordmark({ className = '' }: { className?: string }) {
  const { name } = useAppIdentity()
  const base = 'font-[family-name:var(--font-serif)] font-semibold tracking-[-0.01em]'

  if (name === DEFAULT_APP_NAME) {
    return (
      <span className={`${base} ${className}`}>
        Live<span className="text-[color:var(--signal)]">Transcript</span>
      </span>
    )
  }
  // Custom name: accent the last word (or last char for a one-word name) so it
  // still reads as a mark rather than plain text.
  const trimmed = name.trim()
  const lastSpace = trimmed.lastIndexOf(' ')
  const head = lastSpace > 0 ? trimmed.slice(0, lastSpace + 1) : trimmed.slice(0, -1)
  const tail = lastSpace > 0 ? trimmed.slice(lastSpace + 1) : trimmed.slice(-1)
  return (
    <span className={`${base} ${className}`}>
      {head}
      <span className="text-[color:var(--signal)]">{tail}</span>
    </span>
  )
}
