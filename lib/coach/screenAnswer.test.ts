import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoachController, type CoachTransport } from './controller'
import type { Observation } from './types'

const empty: Observation = { files: [], visiblePaths: [], terminal: '', requirements: [] }
const controllers: CoachController[] = []
function setup() {
  const transport = vi.fn<CoachTransport>(async () => ({ model: 'fixture', guidance: null }))
  const controller = new CoachController(transport)
  controllers.push(controller)
  controller.start('practice', 'Help with the visible task')
  return { controller, transport }
}
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.useRealTimers() })
describe('automatic answers from visible tasks', () => {
  it('answers a screen problem without waiting for audio or a manual Answer click', () => {
    const { controller, transport } = setup()
    controller.observeScreen({ ...empty, requirements: ['Return the indices of two numbers that sum to the target.'] })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0]).toBe('talk')
    expect(transport.mock.calls[0][1].question.text).toContain('sum to the target')
    controller.observeScreen({ ...empty, requirements: ['Return the indices of two numbers that sum to the target.'] })
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('does not invent a question from an empty screen or start requests while paused', () => {
    const { controller, transport } = setup()
    controller.observeScreen(empty)
    expect(transport).not.toHaveBeenCalled()
    controller.pause()
    controller.observeScreen({ ...empty, requirements: ['Write a queue'] })
    expect(transport).not.toHaveBeenCalled()
  })
  it('keeps the current spoken question when a screen supplies additional context', () => {
    const { controller } = setup()
    controller.question('Why is this algorithm quadratic?')
    const id = controller.getSnapshot().question?.id
    controller.observeScreen({ ...empty, requirements: ['Implement two sum'] })
    expect(controller.getSnapshot().question?.id).toBe(id)
  })
})

it('requests writing guidance for a coding question without repository paths', async () => {
  vi.useFakeTimers()
  const { controller, transport } = setup()
  controller.question('Write a Java function that returns the larger of two integers.')
  await vi.advanceTimersByTimeAsync(651)
  expect(transport.mock.calls.map(call => call[0])).toEqual(['talk', 'guide'])
  expect(transport.mock.calls[1][1].knownPaths).toEqual([])
})
