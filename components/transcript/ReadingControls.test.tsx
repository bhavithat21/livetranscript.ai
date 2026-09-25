import { afterEach, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ReadingControls } from './ReadingControls'
import { useTextScale } from '@/lib/transcript/useTextScale'
import { ListeningIndicator } from './ListeningIndicator'
afterEach(()=>{cleanup();localStorage.clear()})
function Reader(){const {scale}=useTextScale();return <p data-testid="scale">{scale}</p>}
it('shares exact custom size, clamps, and persists between mounts',()=>{
  const view=render(<><ReadingControls/><Reader/></>)
  fireEvent.click(screen.getByLabelText('Text size and reading preferences'))
  fireEvent.change(screen.getByLabelText('Custom text size percent'),{target:{value:'175'}})
  fireEvent.blur(screen.getByLabelText('Custom text size percent'))
  expect(screen.getByTestId('scale').textContent).toBe('1.75')
  fireEvent.change(screen.getByLabelText('Reading text size'),{target:{value:'200'}})
  expect(screen.getByTestId('scale').textContent).toBe('2')
  view.unmount();render(<><ReadingControls/><Reader/></>);expect(screen.getByTestId('scale').textContent).toBe('2')
  fireEvent.click(screen.getByText('Reset'));expect(screen.getByTestId('scale').textContent).toBe('1')
})
it('listening meter is driven by amplitude, not a fabricated speech signal',()=>{
  const view=render(<ListeningIndicator active level={0}/>)
  expect(view.container.firstElementChild?.getAttribute('data-speaking')).toBe('false')
  view.rerender(<ListeningIndicator active level={.2}/>)
  expect(view.container.firstElementChild?.getAttribute('data-speaking')).toBe('true')
  view.rerender(<ListeningIndicator active={false} level={.2}/>)
  expect(view.container.firstElementChild?.getAttribute('data-speaking')).toBe('false')
})
