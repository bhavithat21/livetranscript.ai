'use client'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { parseRecognitionMode, RECOGNITION_KEY, type RecognitionMode } from '@/lib/transcription/recognition'

export function RecognitionSettings() {
  const { value: mode, setValue: setMode } = useStoredPreference<RecognitionMode>(RECOGNITION_KEY, 'balanced', parseRecognitionMode)
  const { vocabulary, setVocabulary, keyterms } = useKeytermPrefs()
  return <div className="mt-5 space-y-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-4 sm:p-5">
    <fieldset><legend className="text-sm font-semibold">Phrase finalization</legend>
      <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">Interim captions remain live. These settings apply to the next connection, not the current recording.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(['balanced', 'careful'] as const).map(value => <label key={value} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 ${mode === value ? 'border-[color:var(--signal)] bg-[color:var(--accent-soft)]' : 'border-[color:var(--line)]'}`}>
          <input className="mt-1 accent-[var(--primary-fill)]" type="radio" name="recognitionMode" checked={mode === value} onChange={() => setMode(value)} />
          <span className="text-sm font-medium">{value === 'balanced' ? 'Balanced' : 'Careful'}<span className="mt-1 block text-xs font-normal leading-5 text-[color:var(--muted)]">{value === 'balanced' ? 'Responsive captions with natural phrase breaks.' : 'More pause tolerance for deliberate, technical speech.'}</span></span>
        </label>)}
      </div>
    </fieldset>
    <div><label htmlFor="custom-vocabulary" className="text-sm font-semibold">Your vocabulary</label>
      <p id="vocabulary-help" className="mt-1 text-xs leading-5 text-[color:var(--muted)]">Add names, product names and acronyms you will actually say. One per line or separated by commas. These are recognition hints, never automatic text replacements.</p>
      <textarea id="custom-vocabulary" aria-describedby="vocabulary-help" rows={4} maxLength={4000} value={vocabulary} onChange={event => setVocabulary(event.target.value)} placeholder="Project Atlas, webhook, idempotency" className="mt-3 w-full rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--surface-soft)] p-3 text-sm leading-6" />
      <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">Saved on this device when storage is available. Terms are sent to the speech provider when a recording starts. Avoid confidential values and secrets.</p>
      <details className="mt-3 text-xs text-[color:var(--muted)]"><summary className="cursor-pointer py-2 font-medium">Vocabulary sent to the next recording ({keyterms.length} terms)</summary><p className="mt-2 leading-6">{keyterms.join(' · ') || 'No terms selected.'}</p><p className="mt-2 leading-5">Count and text size are bounded. Unrelated or lengthy packs can be omitted; your vocabulary is prioritized.</p></details>
    </div>
  </div>
}
