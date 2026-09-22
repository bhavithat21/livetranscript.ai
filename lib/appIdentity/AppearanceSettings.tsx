'use client'
import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { AppIconImage } from './AppIconImage'
import { useNativeIdentityMessage } from './AppIdentityEffects'
import { ICON_PRESETS, prepareCustomIcon } from './icons'
import { MAX_APP_NAME_LENGTH, hasAppName, useAppIdentity } from './useAppIdentity'

const CONTROL = 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--signal)] disabled:cursor-not-allowed disabled:opacity-50'

export function AppearanceSettings() {
  const identity = useAppIdentity()
  const nativeMessage = useNativeIdentityMessage()
  const [draftName, setDraftName] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadVersion = useRef(0)
  const name = draftName ?? identity.name

  useEffect(() => () => { uploadVersion.current++ }, [])

  function saved(persisted: boolean, action: string) {
    setStatus(persisted ? `${action} Saved on this device.` : `${action} Browser storage is unavailable; this lasts until you close the app.`)
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    const version = ++uploadVersion.current
    setPreparing(true)
    setFileError(null)
    setStatus('')
    try {
      const icon = await prepareCustomIcon(file)
      if (version !== uploadVersion.current) return
      saved(identity.setIcon(icon), 'Icon updated.')
    } catch (error) {
      if (version !== uploadVersion.current) return
      setFileError(error instanceof Error ? error.message : 'This image could not be opened. Choose another PNG or JPEG.')
      fileInput.current?.focus()
    } finally {
      if (version === uploadVersion.current) {
        setPreparing(false)
        if (fileInput.current) fileInput.current.value = ''
      }
    }
  }

  return (
    <section className="mt-10" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="font-[family-name:var(--font-serif)] text-xl">App appearance</h2>
      <p className="mt-1 max-w-2xl leading-relaxed text-black/55">
        Choose the name and icon you see in the app and browser tab. Your choices stay on this device.
      </p>

      <div className="glass mt-5 rounded-2xl p-5">
        <div className="flex min-w-0 items-center gap-3" aria-label="Current appearance">
          <AppIconImage icon={identity.icon} size={44} />
          <div className="min-w-0">
            <p className="break-words font-[family-name:var(--font-serif)] text-xl">{identity.name}</p>
            <p className="text-xs text-black/55">Current appearance</p>
          </div>
        </div>

        <form className="mt-5" noValidate onSubmit={(event) => {
          event.preventDefault()
          if (!hasAppName(name)) {
            setNameError('Enter an app name, or use Reset appearance to restore LiveTranscript.')
            nameInput.current?.focus()
            return
          }
          saved(identity.save(name), 'Name updated.')
          setDraftName(null)
          setNameError(null)
        }}>
          <label htmlFor="appearance-name" className="text-sm font-medium">App name</label>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <input
              ref={nameInput}
              id="appearance-name"
              name="appName"
              value={name}
              onChange={(event) => { setDraftName(event.target.value); setNameError(null); setStatus('') }}
              maxLength={MAX_APP_NAME_LENGTH}
              autoComplete="off"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'appearance-name-help appearance-name-error' : 'appearance-name-help'}
              className="min-h-11 min-w-0 flex-1 rounded-full border border-black/15 bg-white/70 px-4 py-2.5 text-sm outline-none focus:border-emerald-700 focus-visible:ring-2 focus-visible:ring-[color:var(--signal)]"
            />
            <button type="submit" disabled={name === identity.name} className={`btn-signal px-4 text-sm ${CONTROL}`}>Save name</button>
          </div>
          <p id="appearance-name-help" className="mt-2 text-xs text-black/55">Up to {MAX_APP_NAME_LENGTH} characters. Also updates the desktop window title.</p>
          {nameError && <p id="appearance-name-error" role="alert" className="mt-2 text-sm text-red-700">{nameError}</p>}
        </form>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">App icon</legend>
          {identity.icon.kind === 'custom' && <p className="mt-1 text-xs text-black/55">Custom image selected.</p>}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ICON_PRESETS.map((preset) => {
              const active = identity.icon.kind === 'preset' && identity.icon.id === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    uploadVersion.current++
                    setPreparing(false)
                    setFileError(null)
                    if (fileInput.current) fileInput.current.value = ''
                    saved(identity.setIcon({ kind: 'preset', id: preset.id }), 'Icon updated.')
                  }}
                  className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-xs transition-colors hover:bg-black/5 ${CONTROL} ${active ? 'border-emerald-700 bg-black/5' : 'border-black/15'}`}
                >
                  <AppIconImage icon={{ kind: 'preset', id: preset.id }} size={32} />
                  <span className="flex items-center gap-1">{preset.label}{active && <Check size={13} aria-label="Selected" />}</span>
                </button>
              )
            })}
          </div>

          <label htmlFor="appearance-icon" className="mt-4 block text-sm font-medium">Upload an icon</label>
          <input
            ref={fileInput}
            id="appearance-icon"
            type="file"
            accept="image/png,image/jpeg"
            aria-invalid={Boolean(fileError)}
            aria-describedby={fileError ? 'appearance-icon-help appearance-icon-error' : 'appearance-icon-help'}
            onChange={(event) => { void chooseFile(event.target.files?.[0]) }}
            className={`mt-2 block min-h-11 w-full min-w-0 rounded-xl border border-black/15 px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-black/5 file:px-3 file:py-1 file:text-sm file:text-ink ${CONTROL}`}
          />
          <p id="appearance-icon-help" className="mt-2 text-xs text-black/55">PNG or JPEG, up to 2 MB and 4096 × 4096 pixels. Resized here; never uploaded.</p>
          {fileError && <p id="appearance-icon-error" role="alert" className="mt-2 text-sm text-red-700">{fileError}</p>}
          {preparing && (
            <div className="mt-2 flex items-center gap-3 text-sm text-black/55">
              <span role="status">Preparing icon…</span>
              <button type="button" className={`btn-ghost text-xs ${CONTROL}`} onClick={() => {
                uploadVersion.current++
                setPreparing(false)
                if (fileInput.current) fileInput.current.value = ''
                setStatus('Icon upload canceled.')
              }}>Cancel upload</button>
            </div>
          )}
        </fieldset>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!identity.isCustom && draftName === null && !preparing} className={`btn-ghost text-sm ${CONTROL}`} onClick={() => {
            uploadVersion.current++
            setPreparing(false)
            setDraftName(null)
            setNameError(null)
            setFileError(null)
            if (fileInput.current) fileInput.current.value = ''
            saved(identity.reset(), 'Appearance reset.')
          }}>Reset appearance</button>
          <p role="status" className="min-h-5 text-sm text-black/60">{status}</p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-black/55">
        Desktop: the window icon updates on Windows and Linux. The installed app name, macOS Dock icon,
        and launcher shortcuts change with a custom installer. The app remains listed under its installed name until then.
      </p>
      {nativeMessage && <p role="status" className="mt-2 text-sm text-amber-700">{nativeMessage}</p>}
    </section>
  )
}
