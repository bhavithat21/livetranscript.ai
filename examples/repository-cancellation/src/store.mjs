export function createOrderStore(ids) {
  const states = new Map(ids.map((id) => [id, 'active']))

  return {
    cancel(id) {
      if (states.get(id) !== 'active') return false
      states.set(id, 'cancelled')
      return true
    },
    status(id) {
      return states.get(id)
    },
  }
}
