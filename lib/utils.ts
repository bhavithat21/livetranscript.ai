// Minimal className combiner — joins truthy class values. Enough for our
// conditional classNames without pulling in clsx/tailwind-merge.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
