'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import { Wordmark } from './Wordmark'

// The global shell nav. Present on the marketing + library surfaces, and
// deliberately ABSENT on the focused reading/doing screens (live record, meeting
// room, session detail, the public share view, and auth pages) so nothing
// competes with the transcript for attention. Each of those carries its own
// lightweight back-link instead.
const HIDDEN_PREFIXES = ['/record', '/room', '/s/', '/session/', '/settings', '/sign-in', '/sign-up']

export function AppNav({ clerkConfigured }: { clerkConfigured: boolean }) {
  const pathname = usePathname()
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return null

  return (
    <header className="sticky top-0 z-50 px-4 pt-4">
      <nav
        aria-label="Main"
        className="glass glass-interactive mx-auto flex max-w-6xl items-center gap-3 rounded-full px-4 py-2 sm:gap-6 sm:px-5 sm:py-2.5"
      >
        <Link href="/">
          <Wordmark className="text-lg" />
        </Link>

        {/* Desktop: full link row. Phone (< md): collapse secondary links into a
            menu so the pill never overflows 320px. */}
        <div className="ml-auto flex items-center gap-1 text-sm">
          <div className="hidden items-center gap-1 md:flex">
            {clerkConfigured && (
              <Show when="signed-in">
                <span data-tour="library">
                  <NavLink href="/dashboard" active={pathname === '/dashboard'}>
                    Library
                  </NavLink>
                </span>
              </Show>
            )}
            <NavLink href="/pricing" active={pathname === '/pricing'}>Pricing</NavLink>
            <span data-tour="download">
              <NavLink href="/download" active={pathname === '/download'}>Download</NavLink>
            </span>
            <span data-tour="room">
              <NavLink href="/room/new">New room</NavLink>
            </span>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('lt:start-tour'))}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-black/60 transition-colors hover:bg-black/5 hover:text-ink"
            >
              Tour
            </button>
          </div>
          <Link href="/record" data-tour="record" className="btn-signal ml-1 px-4 text-sm">
            New transcript
          </Link>
          {clerkConfigured && (
            <span className="ml-1 hidden items-center gap-2 md:flex">
              <Show when="signed-out">
                <SignInButton>
                  <button className="inline-flex min-h-11 items-center px-3 text-sm text-black/60 hover:text-ink">Sign in</button>
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
          {/* Phone menu: everything the desktop row holds, behind one 44px button. */}
          <details className="group relative md:hidden">
            <summary className="ml-1 inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full hover:bg-black/5 [&::-webkit-details-marker]:hidden">
              <Menu size={20} />
            </summary>
            <nav className="glass absolute right-0 z-50 mt-2 w-52 rounded-2xl p-1.5 shadow-lg" aria-label="Menu">
              {clerkConfigured && (
                <Show when="signed-in">
                  <MenuLink href="/dashboard">Library</MenuLink>
                </Show>
              )}
              <MenuLink href="/pricing">Pricing</MenuLink>
              <MenuLink href="/download">Download</MenuLink>
              <MenuLink href="/room/new">New room</MenuLink>
              {clerkConfigured && (
                <Show when="signed-out">
                  <SignInButton>
                    <button className="flex w-full min-h-11 items-center rounded-xl px-3 text-left text-sm text-black/70 hover:bg-black/5">Sign in</button>
                  </SignInButton>
                  <SignUpButton>
                    <button className="flex w-full min-h-11 items-center rounded-xl px-3 text-left text-sm text-black/70 hover:bg-black/5">Sign up</button>
                  </SignUpButton>
                </Show>
              )}
              {clerkConfigured && (
                <Show when="signed-in">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <UserButton /> <span className="text-sm text-black/60">Account</span>
                  </div>
                </Show>
              )}
            </nav>
          </details>
        </div>
      </nav>
    </header>
  )
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center rounded-xl px-3 text-sm text-black/70 transition-colors hover:bg-black/5 hover:text-ink"
    >
      {children}
    </Link>
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
      className="inline-flex min-h-11 items-center rounded-full px-3 text-black/60 transition-colors hover:bg-black/5 hover:text-ink focus-visible:bg-black/5 focus-visible:text-ink data-[active=true]:text-ink"
    >
      {children}
    </Link>
  )
}
