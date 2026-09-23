'use client'
import { useEffect, useRef, useState } from 'react'
import { FileText, RotateCcw } from 'lucide-react'
import { useCandidateProfile, type CandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { PROFILE_FIELDS, readProfileText, type ProfileField } from './profileTextImport'

export function CandidateProfileSettings() {
  const profile = useCandidateProfile()
  const [changed, setChanged] = useState(false)
  const [message, setMessage] = useState('')
  const [removed, setRemoved] = useState<CandidateProfile | null>(null)
  const [loading, setLoading] = useState<ProfileField | null>(null)
  const [fileError, setFileError] = useState<{ field: ProfileField; message: string } | null>(null)
  const uploadVersion = useRef(0)
  const inputs = useRef<Partial<Record<ProfileField, HTMLInputElement>>>({})

  useEffect(() => () => { uploadVersion.current++ }, [])

  function update(field: ProfileField, value: string) {
    if (field === 'resume') profile.setResume(value)
    else profile.setJd(value)
    setChanged(true)
    setRemoved(null)
    setMessage('')
  }

  async function importFile(file: File | undefined, field: ProfileField) {
    if (!file) return
    const version = ++uploadVersion.current
    setLoading(field)
    setFileError(null)
    setMessage('')
    try {
      const text = await readProfileText(file, field)
      if (version !== uploadVersion.current) return
      update(field, text)
      setMessage(`${PROFILE_FIELDS[field].label} imported.`)
    } catch (error) {
      if (version !== uploadVersion.current) return
      setFileError({ field, message: error instanceof Error ? error.message : 'This file could not be opened. Try another text file.' })
      inputs.current[field]?.focus()
    } finally {
      if (version === uploadVersion.current) {
        setLoading(null)
        const input = inputs.current[field]
        if (input) input.value = ''
      }
    }
  }

  return (
    <section aria-labelledby="settings-profile-heading">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="settings-profile-heading" className="text-lg font-semibold tracking-[-0.015em]">Your background</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[color:var(--muted)]">Give answers useful context from your actual experience and the role you want.</p>
        </div>
        <button type="button" disabled={!profile.hasProfile} onClick={() => {
          uploadVersion.current++
          setLoading(null)
          setRemoved({ resume: profile.resume, jd: profile.jd })
          profile.clear()
          setChanged(true)
          setFileError(null)
          setMessage('Background cleared.')
        }} className="btn-ghost min-h-11 cursor-pointer px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40">Clear background</button>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {(Object.keys(PROFILE_FIELDS) as ProfileField[]).map((field) => {
          const info = PROFILE_FIELDS[field]
          const error = fileError?.field === field ? fileError.message : null
          return (
            <div key={field} className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`settings-profile-${field}`} className="flex items-center gap-2 text-sm font-semibold"><FileText size={16} aria-hidden className="text-[color:var(--muted)]" />{info.label}</label>
                <span className="text-xs tabular-nums text-[color:var(--muted)]">{profile[field].length.toLocaleString('en-US')} / {info.limit.toLocaleString('en-US')}</span>
              </div>
              <p id={`settings-profile-${field}-help`} className="mt-2 text-xs leading-relaxed text-[color:var(--muted)]">
                {field === 'resume' ? 'Include your projects, responsibilities, skills and real outcomes. Leave out anything you do not want included in an AI answer request.' : 'Paste the role, requirements and company context. This helps tailor examples and technical depth.'}
              </p>
              <textarea
                id={`settings-profile-${field}`}
                name={field}
                value={profile[field]}
                maxLength={info.limit}
                rows={10}
                aria-describedby={`settings-profile-${field}-help`}
                onChange={(event) => {
                  if (loading === field) { uploadVersion.current++; setLoading(null) }
                  setFileError(null)
                  update(field, event.target.value)
                }}
                placeholder={field === 'resume' ? 'Paste your resume or a summary of your experience…' : 'Paste the job description or the role you are preparing for…'}
                className="mt-3 block w-full resize-none rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-[color:var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--signal)]"
              />
              <div className="mt-3">
                <label htmlFor={`settings-profile-${field}-file`} className="text-xs font-medium text-[color:var(--muted)]">{field === 'resume' ? 'Import resume text' : 'Import job description text'}</label>
                <input
                  ref={(element) => { if (element) inputs.current[field] = element }}
                  id={`settings-profile-${field}-file`}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  aria-invalid={Boolean(error)}
                  aria-describedby={`settings-profile-${field}-file-help${error ? ` settings-profile-${field}-error` : ''}`}
                  onChange={(event) => { void importFile(event.target.files?.[0], field) }}
                  className="mt-1.5 block min-h-11 w-full min-w-0 cursor-pointer rounded-lg border border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--muted)] file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[color:var(--surface-soft)] file:px-3 file:py-1 file:text-xs file:font-medium file:text-ink"
                />
                <p id={`settings-profile-${field}-file-help`} className="mt-1.5 text-xs text-[color:var(--muted)]">Plain text or Markdown, up to 64 KB. Import replaces this field.</p>
                {error && <p id={`settings-profile-${field}-error`} role="alert" className="mt-2 text-sm text-[color:var(--stop)]">{error}</p>}
                {loading === field && <div className="mt-2 flex items-center gap-3 text-xs text-[color:var(--muted)]"><span role="status">Reading file…</span><button type="button" className="min-h-11 cursor-pointer font-medium underline underline-offset-4" onClick={() => { uploadVersion.current++; setLoading(null); if (inputs.current[field]) inputs.current[field]!.value = '' }}>Cancel import</button></div>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex min-h-6 flex-wrap items-center gap-3">
        <p role={profile.savedNote ? 'alert' : 'status'} className={`text-xs leading-relaxed ${profile.savedNote ? 'text-[color:var(--stop)]' : 'text-[color:var(--muted)]'}`}>
          {profile.savedNote || `${message}${message ? ' ' : ''}${changed ? 'Saved on this device.' : 'Changes save automatically on this device.'}`}
        </p>
        {removed && <button type="button" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-[color:var(--signal)] underline-offset-4 hover:underline" onClick={() => {
          profile.setResume(removed.resume)
          profile.setJd(removed.jd)
          setRemoved(null)
          setMessage('Background restored.')
        }}><RotateCcw size={13} aria-hidden />Undo clear</button>}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Your background is included as context when you request AI answers. It is shared by the copilot and interview workflows on this device.</p>
    </section>
  )
}
