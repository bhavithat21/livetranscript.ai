'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'

// The global shell nav. Present on the marketing + library surfaces, and
// deliberately ABSENT on the focused reading/doing screens (live record, meeting
// room, session detail, the public share view, and auth pages) so nothing
// competes with the transcript for attention. Each of those carries its own
// lightweight back-link instead.
const HIDDEN_PREFIXES = ['/record', '/room', '/s/', '/session/', '/sign-in', '/sign-up']

export function AppNav({ clerkConfigured }: { clerkConfigured: boolean }) {
  const pathname = usePathname()
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return null

  return (
    <header className="sticky top-0 z-50 px-4 pt-4">
      <nav
        aria-label="Main"
        className="glass glass-interactive mx-auto flex max-w-6xl items-center gap-6 rounded-full px-5 py-2.5"
      >
        <Link
          href="/"
          className="font-[family-name:var(--font-serif)] text-lg font-semibold tracking-[-0.01em]"
        >
          Live<span className="text-emerald-700">Transcript</span>
        </Link>

        <div className="ml-auto flex items-center gap-1 text-sm">
          {clerkConfigured && (
            <Show when="signed-in">
              <NavLink href="/dashboard" active={pathname === '/dashboard'}>
                Library
              </NavLink>
            </Show>
          )}
          <NavLink href="/room/new">New room</NavLink>
          <Link href="/record" className="btn-signal ml-1 px-4 py-1.5 text-sm">
            New transcript
          </Link>
          {clerkConfigured && (
            <span className="ml-2 flex items-center gap-2">
              <Show when="signed-out">
                <SignInButton>
                  <button className="text-sm text-black/60 hover:text-ink">Sign in</button>
                </SignInButton>
                <SignUpButton>
                  <button className="btn-ghost text-sm">Sign up</button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </span>
          )}
        </div>
      </nav>
    </header>
  )
}

function NavLink({
  href,
  children,
  active = false,
}: {
  href: string
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <Link
      href={href}
      data-active={active}
      className="rounded-full px-3 py-1.5 text-black/60 transition-colors hover:bg-black/5 hover:text-ink data-[active=true]:text-ink"
    >
      {children}
    </Link>
  )
}
