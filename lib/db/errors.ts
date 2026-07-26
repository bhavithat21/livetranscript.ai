// Thrown when a request has no signed-in user or the DB isn't configured — the
// "there's simply nothing to show" case, distinct from a real query/outage error.
// Server Components catch this to render an empty state (or 404) instead of
// letting an outage masquerade as "no transcripts".
export class NoSessionContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoSessionContextError'
  }
}
