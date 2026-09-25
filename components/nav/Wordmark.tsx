'use client'
import { useAppIdentity, DEFAULT_APP_NAME } from '@/lib/appIdentity/useAppIdentity'
import { AppIconImage } from '@/lib/appIdentity/AppIconImage'
import { BrandMark } from '@/components/brand/BrandMark'

// Shared wordmark honors the user's device-local name and icon.
export function Wordmark({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const { name, icon } = useAppIdentity()
  const base = 'font-[family-name:var(--font-body)] font-semibold tracking-[-0.035em]'
  const customIcon = icon.kind !== 'preset' || icon.id !== 'default'
  const mark = customIcon ? <AppIconImage icon={icon} size={compact ? 22 : 28} /> : <BrandMark size={compact ? 26 : 34} />

  if (name === DEFAULT_APP_NAME) {
    return (
      <span className={`inline-flex min-w-0 items-center gap-2 ${base} ${className}`} title={name}>
        {mark}
        <span>Live{compact ? 'T' : 'Transcript'}</span>
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
    <span className={`inline-flex min-w-0 items-center gap-2 ${base} ${className}`} title={name}>
      {mark}
      <span className="max-w-[min(35vw,14rem)] truncate">{head}<span className="text-[color:var(--signal)]">{tail}</span></span>
    </span>
  )
}
