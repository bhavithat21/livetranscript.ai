import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOrderStore } from './src/store.mjs'
import { createOrderService } from './src/orders.mjs'

function setup() {
  const events = []
  const store = createOrderStore(['order-1'])
  const service = createOrderService(store, (event) => events.push(event))
  return { events, store, service }
}

test('first cancellation changes the state and emits one event', () => {
  const { service, store, events } = setup()
  assert.equal(service.cancel('order-1'), true)
  assert.equal(store.status('order-1'), 'cancelled')
  assert.deepEqual(events, [{ type: 'order.cancelled', id: 'order-1' }])
})

test('retry does not emit a second cancellation event', () => {
  const { service, events } = setup()
  service.cancel('order-1')
  assert.equal(service.cancel('order-1'), false)
  assert.equal(events.length, 1)
})

test('unknown orders do not emit cancellation events', () => {
  const { service, events } = setup()
  assert.equal(service.cancel('missing'), false)
  assert.equal(events.length, 0)
})
