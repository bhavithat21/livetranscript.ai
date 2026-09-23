'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Copy, Download, Monitor, MousePointer2, Link2, ShieldCheck, Square, LockKeyhole, Eye } from 'lucide-react'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { RemoteSessionClient, initialRemoteSnapshot, type RemoteSnapshot } from '@/lib/remote/client'
import { getRemoteCapabilities, getRemoteDisplays, type RemoteDisplay } from '@/lib/remote/native'
import { parseRemoteInvitation } from '@/lib/remote/invite'
import { RemoteScreen, type RemoteScreenHandle } from './RemoteScreen'
import { RemoteNotes } from './RemoteNotes'

const ACTIVE = new Set(['creating', 'waiting', 'connecting', 'connected'])
const STATUS: Record<RemoteSnapshot['status'], string> = {
  idle: 'Ready when you are', creating: 'Opening a secure session…', waiting: 'Waiting for approval',
  connecting: 'Connecting devices…', connected: 'Connected', ended: 'Session ended', error: 'Connection needs attention',
}

export function RemoteAssist() {
  const [mode, setMode] = useState<'host' | 'controller'>('controller')
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>(initialRemoteSnapshot)
  const [displays, setDisplays] = useState<RemoteDisplay[]>([])
  const [displayId, setDisplayId] = useState('')
  const [nativeState, setNativeState] = useState<'loading' | 'ready' | 'browser' | 'error'>('loading')
  const [stopShortcut, setStopShortcut] = useState('Ctrl/Cmd + Shift + Escape')
  const [deviceError, setDeviceError] = useState('')
  const [invitation, setInvitation] = useState('')
  const [invitationError, setInvitationError] = useState('')
  const [showInvitation, setShowInvitation] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [screenClient, setScreenClient] = useState<RemoteSessionClient | null>(null)
  const client = useRef<RemoteSessionClient | null>(null)
  const screen = useRef<RemoteScreenHandle | null>(null)
  const inviteInput = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const mounted = useRef(false)
  const deviceEpoch = useRef(0)

  const loadDisplays = useCallback(async () => {
    const epoch = ++deviceEpoch.current
    setDeviceError('')
    setNativeState('loading')
    try {
      const capabilities = await getRemoteCapabilities()
      if (!mounted.current || epoch !== deviceEpoch.current) return
      if (!capabilities.supported) { setNativeState('browser'); return }
      setStopShortcut(capabilities.stopShortcutRegistered === true ? capabilities.stopShortcut : '')
      const available = await getRemoteDisplays()
      if (!mounted.current || epoch !== deviceEpoch.current) return
      if (!available.length) throw new Error('No display is available. Connect a display and try again.')
      setDisplays(available)
      setDisplayId(available.find((display) => display.isPrimary)?.id ?? available[0].id)
      setNativeState('ready')
    } catch (error) {
      if (!mounted.current || epoch !== deviceEpoch.current) return
      setNativeState('error')
      setDeviceError(error instanceof Error ? error.message : 'The desktop connection is unavailable. Update the app and try again.')
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    let canceled = false
    const connection = new RemoteSessionClient({
      onChange(next) {
        if (!canceled) {
          setSnapshot(next)
          if (next.role === 'controller' && (next.status === 'waiting' || next.status === 'connected')) setInvitation('')
        }
      },
      onFrame(jpeg) { screen.current?.draw(jpeg) },
    })
    client.current = connection
    queueMicrotask(() => { if (!canceled) setScreenClient(connection) })
    // A shared invite can arrive in a fragment, which is never sent to the API
    // as a URL. Remove it before any user interaction or page navigation.
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const invite = fragment.get('invite')
    if (invite) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      queueMicrotask(() => { if (!canceled) setInvitation(invite.slice(0, 8192)) })
    } else if ('__TAURI_INTERNALS__' in window) {
      queueMicrotask(() => { if (!canceled) setMode('host') })
    }
    queueMicrotask(() => { if (!canceled) void loadDisplays() })
    const invalidateDisplays = () => { deviceEpoch.current++ }
    return () => {
      canceled = true
      mounted.current = false
      invalidateDisplays()
      connection.dispose()
      client.current = null
    }
  }, [loadDisplays])

  async function run(action: () => void | Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setNotice('')
    try { await action() }
    catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : 'The action could not finish. Please try again.') }
    finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }

  const active = ACTIVE.has(snapshot.status)
  const connected = snapshot.status === 'connected'
  const isHost = snapshot.role === 'host'

  return (
    <WorkspaceShell active="remote">
      <main className="ph-no-capture mx-auto w-full max-w-[1200px] px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-8" data-ph-no-capture>
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-[color:var(--muted)]"><Monitor size={14} aria-hidden /> Connected workspace</p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Remote assist</h1>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">Share a display with a trusted helper. Keep viewing, notes, and laptop control in one place.</p>
          </div>
          <Link href="/download" className="btn-ghost gap-2 text-sm"><Download size={15} aria-hidden /> Desktop app</Link>
        </header>

        <div className="sticky top-[calc(var(--titlebar-h,0px)+0.75rem)] z-10 mb-5 flex min-h-16 flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] px-4 py-3">
          <div>
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-[color:var(--muted)]'}`} aria-hidden />
              {snapshot.status === 'waiting' && isHost ? 'Waiting for your helper' : STATUS[snapshot.status]}
            </p>
            <p className="mt-1 pl-4 text-xs text-[color:var(--muted)]">{connected ? snapshot.controlEnabled ? 'The helper can use the mouse and keyboard.' : 'Viewing only. Laptop input remains with the owner.' : 'Screen access begins after the laptop owner approves.'}</p>
          </div>
          {active && <button type="button" className="btn-stop gap-2 text-sm" onClick={() => { client.current?.stop('Stopped from this device'); setShowInvitation(false) }}><Square size={14} aria-hidden /> End session</button>}
        </div>

        {(snapshot.error || snapshot.endedReason || notice) && (
          <div role={snapshot.error ? 'alert' : 'status'} className="reader-surface mb-6 rounded-lg border border-[color:var(--line)] p-4 text-sm leading-relaxed">
            {snapshot.error || snapshot.endedReason || notice}
            {!active && <p className="mt-1 text-[color:var(--muted)]">Start a new session to reconnect. The previous connection is closed.</p>}
          </div>
        )}

        {!active && (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
          <section aria-label="Connection setup" className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-6">
            <div className="mb-6 grid gap-2 sm:grid-cols-2" aria-label="Your role">
              <button type="button" aria-label="Share this laptop" className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-[color:var(--surface-soft)] ${mode === 'host' ? 'border-[color:var(--signal)] bg-[color:var(--surface-soft)]' : 'border-[color:var(--line)]'}`} aria-pressed={mode === 'host'} onClick={() => { setMode('host'); setNotice('') }}><Monitor size={19} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--signal)]" /><span><span className="block text-sm font-semibold">Share this laptop</span><span className="mt-1 block text-xs leading-relaxed text-[color:var(--muted)]">Invite a helper from the desktop app.</span></span></button>
              <button type="button" aria-label="Control a laptop" className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-[color:var(--surface-soft)] ${mode === 'controller' ? 'border-[color:var(--signal)] bg-[color:var(--surface-soft)]' : 'border-[color:var(--line)]'}`} aria-pressed={mode === 'controller'} onClick={() => { setMode('controller'); setNotice('') }}><MousePointer2 size={19} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--signal)]" /><span><span className="block text-sm font-semibold">Control a laptop</span><span className="mt-1 block text-xs leading-relaxed text-[color:var(--muted)]">Join with an invitation in your browser.</span></span></button>
            </div>
            {mode === 'host' ? (
              <div className="max-w-2xl space-y-5">
                <div><h2 className="text-xl font-semibold">Choose what to share</h2><p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">Your helper sees this display after you approve their connection. Mouse and keyboard access starts off.</p></div>
                {nativeState === 'loading' && <p role="status" className="text-sm text-[color:var(--muted)]">Checking the desktop app and connected displays…</p>}
                {nativeState === 'browser' && <div className="space-y-3"><p className="text-sm leading-relaxed text-[color:var(--muted)]">Open the desktop app on the laptop you want to share. A browser can connect as a helper; sharing and controlling laptop apps requires the desktop app.</p><Link href="/download" className="btn-signal gap-2 text-sm"><Download size={16} aria-hidden /> Get the desktop app</Link></div>}
                {nativeState === 'error' && <div className="space-y-3"><p role="alert" className="text-sm">{deviceError}</p><div className="flex flex-wrap gap-2"><button className="btn-ghost text-sm" type="button" onClick={() => void loadDisplays()}>Check again</button><Link href="/download" className="btn-ghost text-sm">Get the latest desktop app</Link></div></div>}
                {nativeState === 'ready' && <>
                  <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Display to share</legend>{displays.map((display) => <label key={display.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[color:var(--line)] p-4"><input type="radio" name="shared-display" checked={displayId === display.id} onChange={() => setDisplayId(display.id)} className="h-4 w-4 accent-[color:var(--signal)]" /><Monitor size={20} className="shrink-0 text-[color:var(--muted)]" aria-hidden /><span className="min-w-0"><span className="block break-words text-sm font-medium">{display.name}{display.isPrimary ? ' · Main display' : ''}</span><span className="text-xs text-[color:var(--muted)]">{display.width} × {display.height}</span></span></label>)}</fieldset>
                  <button type="button" disabled={busy || !displayId} aria-busy={busy} className="btn-signal gap-2 text-sm" onClick={() => void run(async () => { setCopied(false); setShowInvitation(false); await client.current?.createHost(displayId) })}>Create invitation <ArrowUpRight size={16} aria-hidden /></button>
                  <p className="text-xs leading-relaxed text-[color:var(--muted)]">Nothing is shared until you approve a helper. Sessions last up to 30 minutes.</p>
                </>}
              </div>
            ) : (
              <form noValidate className="max-w-2xl space-y-4" onSubmit={(event) => {
                event.preventDefault()
                let invite: string
                try { invite = parseRemoteInvitation(invitation); setInvitationError('') }
                catch (error) { setInvitationError(error instanceof Error ? error.message : 'Paste a valid invitation.'); inviteInput.current?.focus(); return }
                void run(async () => { await client.current?.join(invite) })
              }}>
                <div><h2 className="text-xl font-semibold">Connect to a laptop</h2><p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">Ask the laptop owner to open Remote assist and copy their invitation. You can also connect from your own second device.</p></div>
                <div className="space-y-2"><label htmlFor="remote-invitation" className="block text-sm font-medium">Invitation</label><input ref={inviteInput} id="remote-invitation" type="password" value={invitation} onChange={(event) => { setInvitation(event.target.value); setInvitationError('') }} maxLength={8192} autoComplete="off" spellCheck={false} autoCapitalize="none" aria-invalid={Boolean(invitationError)} aria-describedby={invitationError ? 'remote-invitation-error' : 'remote-invitation-help'} className="min-h-11 w-full rounded-lg border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm" placeholder="Paste the invitation from the laptop" />{invitationError ? <p id="remote-invitation-error" role="alert" className="text-sm text-[color:var(--stop)]">{invitationError}</p> : <p id="remote-invitation-help" className="text-xs text-[color:var(--muted)]">The owner approves your helper code before sharing starts.</p>}</div>
                <button type="submit" className="btn-signal gap-2 text-sm" disabled={busy} aria-busy={busy}>Request connection <ArrowUpRight size={16} aria-hidden /></button>
              </form>
            )}
          </section>
          <aside className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5" aria-label="How remote assist works">
            <h2 className="text-sm font-semibold">A connection you control</h2>
            <ol className="mt-5 space-y-5">
              <li className="flex gap-3"><Link2 size={17} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--signal)]" /><div><h3 className="text-sm font-medium">Share an invitation</h3><p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Send it only to the person you want to connect.</p></div></li>
              <li className="flex gap-3"><Eye size={17} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--signal)]" /><div><h3 className="text-sm font-medium">Approve viewing</h3><p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Compare the helper code before sharing the display.</p></div></li>
              <li className="flex gap-3"><LockKeyhole size={17} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--signal)]" /><div><h3 className="text-sm font-medium">Choose when to hand over</h3><p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Mouse and keyboard control needs a separate action. Revoke it at any time.</p></div></li>
            </ol>
            <p className="mt-5 border-t border-[color:var(--line)] pt-4 text-xs leading-relaxed text-[color:var(--muted)]">Both devices must be signed in. One approved helper can connect for up to 30 minutes.</p>
          </aside>
          </div>
        )}

        {active && isHost && (
          <section className="space-y-6 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-6" aria-label="Laptop session">
            <div><h2 className="text-xl font-semibold">{connected ? 'Your screen is shared' : 'Invite your helper'}</h2><p className="mt-1 text-sm text-[color:var(--muted)]">{snapshot.display?.name ?? displays.find((display) => display.id === displayId)?.name ?? 'Selected display'}</p></div>
            {snapshot.status === 'waiting' && snapshot.invite && <div className="space-y-3"><p className="text-sm leading-relaxed text-[color:var(--muted)]">On the other device, open <span className="font-medium">Remote assist → Control a laptop</span> and paste this invitation. Both devices need to be signed in.</p><div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-signal gap-2 text-sm" onClick={() => void run(async () => { await navigator.clipboard.writeText(snapshot.invite!); setCopied(true); setNotice('Invitation copied. Share it with the person you want to connect.') })}>{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{copied ? 'Copied' : 'Copy invitation'}</button><button type="button" className="btn-ghost text-sm" aria-expanded={showInvitation} onClick={() => setShowInvitation(!showInvitation)}>{showInvitation ? 'Hide invitation' : 'Show invitation'}</button></div>{showInvitation && <div><label htmlFor="host-invitation" className="mb-1 block text-xs text-[color:var(--muted)]">Invitation · share only with your helper</label><textarea id="host-invitation" value={snapshot.invite} readOnly rows={4} onFocus={(event) => event.currentTarget.select()} className="w-full resize-none break-all rounded-lg border border-[color:var(--line)] bg-transparent p-3 font-mono text-xs" /></div>}</div>}
            {snapshot.pending.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold">Connection requests</h3><p className="text-sm text-[color:var(--muted)]">Confirm the code shown on your helper’s device before approving.</p><ul className="space-y-2">{snapshot.pending.map((helper) => <li key={helper.clientId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--line)] p-4"><span className="font-mono text-sm">{helper.code}</span><div className="flex gap-2"><button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => void run(async () => { await client.current?.deny(helper.clientId) })}>Decline</button><button type="button" className="btn-signal text-sm" disabled={busy} onClick={() => void run(async () => { setShowInvitation(false); await client.current?.approve(helper.clientId) })}>Approve viewing</button></div></li>)}</ul></div>}
            {connected && <div className="space-y-4"><div className="reader-surface rounded-lg border border-[color:var(--line)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} aria-hidden />{snapshot.controlEnabled ? 'Mouse and keyboard control is on' : 'View only'}</h3><p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">{snapshot.controlEnabled ? 'Your helper can click, type, scroll and use applications on your laptop. Turn control off to keep sharing the screen without input.' : 'Your helper can see the selected display. Enable control when you want them to click, type, scroll and use laptop applications.'}</p></div><button type="button" disabled={busy} aria-busy={busy} className={snapshot.controlEnabled ? 'btn-stop text-sm' : 'btn-signal text-sm'} onClick={() => void run(async () => { await client.current?.setControl(!snapshot.controlEnabled) })}>{snapshot.controlEnabled ? 'Turn control off' : 'Allow mouse and keyboard'}</button></div>}
            <p className="border-t border-[color:var(--line)] pt-4 text-sm leading-relaxed text-[color:var(--muted)]">Stop from this page or the desktop tray{stopShortcut && <>, or <kbd className="font-mono text-xs">{stopShortcut}</kbd></>}. {!stopShortcut && 'The global stop shortcut is unavailable on this device. '}A lost connection automatically stops sharing and releases held keys.</p>
          </section>
        )}

        {active && !isHost && snapshot.role === 'controller' && (
          <section className="space-y-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-6" aria-label="Helper session">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{connected ? 'Laptop connection' : 'Ask the owner to approve you'}</h2><p className="mt-2 text-sm text-[color:var(--muted)]">Your helper code: <span className="font-mono font-semibold text-ink">{snapshot.helperCode ?? '…'}</span></p></div><span className="rounded-md border border-[color:var(--line)] px-3 py-1 text-xs font-medium">{snapshot.controlEnabled ? 'Control enabled' : 'View only'}</span></div>
            {connected ? <RemoteScreen client={screenClient} enabled={snapshot.controlEnabled} screenRef={screen} /> : <p className="text-sm leading-relaxed text-[color:var(--muted)]">The laptop owner must approve this code. Keep this page open while the connection is established.</p>}
          </section>
        )}

        {connected && <RemoteNotes client={screenClient} snapshot={snapshot} />}

        {active && !snapshot.relayConfigured && <p className="mt-4 text-xs leading-relaxed text-[color:var(--muted)]">Direct connection mode. Some office or mobile networks need a relay; if the devices cannot connect, try another network. Relay configuration is available in the setup guide.</p>}
        <footer className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[color:var(--muted)]"><span>One display · one approved helper · up to 30 minutes</span><Link href="/settings#appearance" className="underline underline-offset-4">Change app name and icon</Link></footer>
      </main>
    </WorkspaceShell>
  )
}
