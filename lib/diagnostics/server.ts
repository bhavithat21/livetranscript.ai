import { UUID, sanitizeAttributes, type Stage, type DiagnosticEventName } from './schema'
/** No raw request/user/header/provider data enters operational logs. */
export function serverDiagnostic(req: Request, stage: Stage, event: DiagnosticEventName, attrs: unknown = {}) {
  try {
    const session = req.headers.get('x-lt-session-id') ?? '', operation = req.headers.get('x-lt-operation-id') ?? ''
    const entry = { v: 1, origin: 'server', at: Date.now(), stage, event,
      ...(UUID.test(session) ? { sessionId: session } : {}), ...(UUID.test(operation) ? { operationId: operation } : {}),
      attrs: sanitizeAttributes({ ...sanitizeAttributes(attrs), release: process.env.VERCEL_GIT_COMMIT_SHA }) }
    const line = '[lt-diagnostics] ' + JSON.stringify(entry)
    if (event === 'error') console.warn(line)
    else console.info(line)
  } catch { /* reporting cannot break requests */ }
}
