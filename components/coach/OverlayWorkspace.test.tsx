// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OverlayWorkspace } from './OverlayWorkspace'
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it.each([
  '{"say":{"x":16,"y":174,"width":300,"height":155,"opacity":60},"code":{"opacity":78},"transcript":{"opacity":58}}',
  'null',
  '{"next":null,"say":null}',
])('renders the live panels with an older or invalid saved layout: %s', raw => {
  localStorage.setItem('lt-overlay-layout-v2', raw)
  render(<OverlayWorkspace next="Next action" say="Spoken answer" code="Implementation" writing="Explanation" transcript="Question" />)
  for (const name of ['What to do next', 'What to say', 'What to write']) expect(screen.getByRole('region', { name })).toBeTruthy()
})
