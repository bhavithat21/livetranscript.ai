/** Start OS permission flows serially, but isolate failures. A failed call input
 * must never stop a healthy microphone (or vice versa). No automatic OS reprompt. */
export async function startIndependentChannels(channels: Array<{ name: 'system' | 'mic'; start: () => Promise<void> }>, current: () => boolean): Promise<string[]> {
  const failures: string[] = []
  for (const channel of channels) {
    if (!current()) break
    try { await channel.start() }
    catch (cause) {
      if (!current()) break
      const detail = cause instanceof Error ? cause.message : 'Could not start this input.'
      failures.push(`${channel.name === 'system' ? 'Call audio' : 'Microphone'}: ${detail}`)
    }
  }
  return failures
}
