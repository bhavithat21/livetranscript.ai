// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ListeningIndicator } from './ListeningIndicator'
afterEach(cleanup)
it('does not animate speaking for an open but silent microphone', () => {
  const {container} = render(<ListeningIndicator active level={0} />)
  expect(container.querySelector('[data-speaking="false"]')).not.toBeNull()
  expect(screen.getByText('Listening')).toBeTruthy()
})
it('reflects measured energy and stops when capture stops', () => {
  const {container, rerender} = render(<ListeningIndicator active level={.1} />)
  expect(container.querySelector('[data-speaking="true"]')).not.toBeNull()
  expect(screen.getByText('Speech detected')).toBeTruthy()
  rerender(<ListeningIndicator active={false} level={.1} />)
  expect(container.querySelector('[data-speaking="false"]')).not.toBeNull()
  expect(screen.getByText('Audio paused')).toBeTruthy()
})
it('treats missing or invalid energy as silence, not simulated speech', () => {
  const {container} = render(<ListeningIndicator active level={Number.NaN} />)
  expect(container.querySelector('[data-speaking="false"]')).not.toBeNull()
  expect(container.innerHTML).not.toContain('NaN')
})
