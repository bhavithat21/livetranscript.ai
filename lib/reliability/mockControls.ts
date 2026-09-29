/** Local, explicit mock controls. No network endpoint or global window hook.
 * Contains callbacks only, never PCM, transcript, prompts, or capture handles. */
const targets = new Map<string, () => boolean>()
export function registerRecoveryTest(id: string, action: () => boolean) {
  targets.set(id, action)
  return () => { if (targets.get(id) === action) targets.delete(id) }
}
export function testAsrRecovery() { let started = 0; for (const action of targets.values()) if (action()) started++; return started }
