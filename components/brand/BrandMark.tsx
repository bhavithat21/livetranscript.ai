import { CAPTION_MARK_PATH } from '@/lib/brand/mark'
export function BrandMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <span className={`brand-mark ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" focusable="false"><rect width="40" height="40" rx="11" fill="currentColor" /><g transform="translate(4 4)" stroke="var(--brand-ink, #25271f)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={CAPTION_MARK_PATH} /></g><circle cx="27" cy="23" r="1.5" fill="#aa3c24" /></svg>
  </span>
}
