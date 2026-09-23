// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppNav } from './AppNav'

const navigation = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props} onClick={(event) => event.preventDefault()}>{children}</a> }))
vi.mock('@clerk/nextjs', () => ({ Show: ({ children }: { children: React.ReactNode }) => children, SignInButton: ({ children }: { children: React.ReactNode }) => children, UserButton: () => <span>Account</span> }))
vi.mock('./Wordmark', () => ({ Wordmark: () => <span>LiveTranscript</span> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <span>Theme</span> }))
afterEach(cleanup)

describe('public navigation ownership', () => {
  it.each(['/dashboard', '/interview', '/copilot', '/practice', '/remote', '/settings', '/record', '/room/new', '/session/example', '/s/example', '/sign-in', '/sign-up'])('leaves %s to its route shell', (pathname) => {
    navigation.pathname = pathname
    render(<AppNav clerkConfigured={false} />)
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('provides public navigation and an active page without configured authentication', () => {
    navigation.pathname = '/pricing'
    render(<AppNav clerkConfigured={false} />)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Pricing' })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Open workspace' }).getAttribute('href')).toBe('/interview')
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })
  it('closes the mobile disclosure on Escape or route navigation', () => {
    navigation.pathname = '/'
    render(<AppNav clerkConfigured={false} />)
    const summary = screen.getByLabelText('Open navigation')
    const menu = summary.closest('details')!
    menu.open = true
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(summary)
    menu.open = true
    fireEvent.click(screen.getByRole('link', { name: 'Interview workspace' }))
    expect(menu.open).toBe(false)
  })
})
