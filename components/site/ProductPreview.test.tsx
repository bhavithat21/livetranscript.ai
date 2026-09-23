// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductPreview } from './ProductPreview'

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a> }))
afterEach(cleanup)

describe('public product example', () => {
  it('labels sample content and opens the matching real workflow', () => {
    render(<ProductPreview />)
    expect(screen.getByText('Illustrative session')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Live interview' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('link', { name: 'Open Live' }).getAttribute('href')).toBe('/interview')
    expect(screen.getByText(/Sample content, no recording in progress/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Mock Lab' }))
    expect(screen.getByRole('button', { name: 'Mock Lab' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Live interview' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('link', { name: 'Open Mock Lab' }).getAttribute('href')).toBe('/interview#mock')
    expect(screen.queryByRole('heading', { name: 'How would you design a distributed notification service?' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'AI workspace' }))
    expect(screen.getByRole('link', { name: 'Open AI workspace' }).getAttribute('href')).toBe('/copilot')
    expect(screen.getByText('When should I use a queue instead of synchronous calls?')).toBeTruthy()
  })
})
