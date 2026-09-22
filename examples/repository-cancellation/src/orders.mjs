export function createOrderService(store, publish) {
  return {
    cancel(id) {
      const changed = store.cancel(id)
      publish({ type: 'order.cancelled', id })
      return changed
    },
  }
}
