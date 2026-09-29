/** Optional telemetry port. The deterministic coach core remains compilable and
 * executable without Next.js, path aliases, storage, network or React. */
type Stage = 'screen' | 'screen_model' | 'talk' | 'guide' | 'review'
type Event = 'start' | 'ready' | 'first_frame' | 'first_token' | 'heartbeat' | 'success' | 'error' | 'cancelled' | 'stop' | 'paused' | 'feedback' | 'retry'
type Trace = { id: string; headers(): Record<string, string>; event(event: Event, attrs?: unknown): void; end(event: 'success' | 'error' | 'cancelled' | 'stop', attrs?: unknown): void; failure(error: unknown, status?: number): void }
type Sink = { span(stage: Stage, attrs?: unknown): Trace; record(stage: Stage, event: Event, attrs?: unknown): void; code(error: unknown, status?: number): string }
let sink: Sink | null = null
const noop: Trace = { id: '', headers: () => ({}), event() {}, end() {}, failure() {} }
export function installCoachDiagnostics(value: Sink) { sink = value }
export function diagnosticSpan(stage: Stage, attrs?: unknown): Trace { try { return sink?.span(stage, attrs) ?? noop } catch { return noop } }
export function recordDiagnostic(stage: Stage, event: Event, attrs?: unknown) { try { sink?.record(stage, event, attrs) } catch { /* never change core execution */ } }
export function diagnosticCode(error: unknown, status?: number): string { try { return sink?.code(error, status) ?? 'unknown' } catch { return 'unknown' } }
