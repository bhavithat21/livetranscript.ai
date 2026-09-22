'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Download, Monitor, Pause, Play, Upload } from 'lucide-react'
import type { useScreenRepository, RepoTask } from '@/lib/repo/useScreenRepository'
import { screenFileSummary, screenNavigation, screenContext } from '@/lib/repo/screenEvidence'
import { Markdown } from './Markdown'

type ScreenRepo = ReturnType<typeof useScreenRepository>

export function ScreenRepositoryControls({ repo, sharing, startSharing, question, onAnalyze }: {
  repo: ScreenRepo; sharing: boolean; startSharing: () => Promise<void>
  question: string; onAnalyze: (task: RepoTask) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [readingImage, setReadingImage] = useState(false)
  const uploadGeneration = useRef(0)
  const uploadReader = useRef<FileReader | null>(null)
  useEffect(() => () => {
    // A pending file read must not start a paid capture after leaving this view.
    uploadGeneration.current += 1
    if (uploadReader.current?.readyState === FileReader.LOADING) uploadReader.current.abort()
    uploadReader.current = null
  }, [])
  const navigation = screenNavigation(repo.snapshot, question)
  const summaries = repo.snapshot.files.map(screenFileSummary)
  const upload = async (file?: File) => {
    if (!file) return
    setUploadError(null)
    // Reset immediately so choosing the same file again can retry a failure.
    if (input.current) input.current.value = ''
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4_400_000) {
      setUploadError('Choose a PNG, JPEG or WebP screenshot under 4.4 MB.'); return
    }
    const generation = ++uploadGeneration.current
    setReadingImage(true)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        uploadReader.current = reader
        reader.onload = () => {
          if (uploadReader.current === reader) uploadReader.current = null
          resolve(String(reader.result))
        }
        reader.onerror = () => {
          if (uploadReader.current === reader) uploadReader.current = null
          reject(new Error('Could not read image'))
        }
        reader.onabort = () => reject(new Error('Screenshot read cancelled'))
        reader.readAsDataURL(file)
      })
      if (generation !== uploadGeneration.current) return
      await repo.captureImage(image, true)
    } catch {
      if (generation === uploadGeneration.current) setUploadError('Could not read this screenshot. Try another image.')
    } finally {
      if (generation === uploadGeneration.current) setReadingImage(false)
    }
  }
  const clear = () => {
    uploadGeneration.current += 1
    if (uploadReader.current?.readyState === FileReader.LOADING) uploadReader.current.abort()
    uploadReader.current = null
    setReadingImage(false)
    setUploadError(null)
    if (input.current) input.current.value = ''
    repo.reset()
  }
  const canClear = !!(repo.snapshot.captures || repo.captureError || uploadError || readingImage || repo.capturing || repo.analysis || repo.history.length)
  const exportEvidence = () => {
    const blob = new Blob([JSON.stringify({ format: 'livetranscript-screen-evidence-v1', ...repo.snapshot }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'repository-screen-evidence.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section aria-label="Repository screenshots" className="shrink-0 border-b border-black/10 bg-emerald-950/[0.035] px-4 py-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Build repo from screenshots</p>
        <span className="text-[10px] text-black/55">{repo.snapshot.captures} captures · {summaries.length} files</span>
      </div>
      <p className="mt-1 text-[11px] text-black/60">Open files with their full path and line numbers visible. Scroll with overlap; captured code stays in this session.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {!sharing && <button className="btn-ghost flex items-center gap-1 px-2 py-1.5" onClick={() => void startSharing()}><Monitor size={12} />Share IDE</button>}
        <button className="btn-signal flex items-center gap-1 px-2 py-1.5 disabled:opacity-40" disabled={!sharing || repo.capturing || readingImage} onClick={() => void repo.capture()}><Camera size={12} />{repo.capturing ? 'Reading…' : 'Capture code'}</button>
        <button className="btn-ghost flex items-center gap-1 px-2 py-1.5 disabled:opacity-40" disabled={!sharing} aria-pressed={repo.watching} onClick={() => repo.setWatching(!repo.watching)}>{repo.watching ? <Pause size={12} /> : <Play size={12} />}{repo.watching ? 'Pause capture' : 'Watch IDE'}</button>
        <button className="btn-ghost flex items-center gap-1 px-2 py-1.5 disabled:opacity-40" disabled={repo.capturing || readingImage} onClick={() => input.current?.click()}><Upload size={12} />Screenshot</button>
        <input ref={input} type="file" aria-label="Upload repository screenshot" disabled={repo.capturing || readingImage} accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
      <p className="mt-1.5 text-[10px] text-black/55">{repo.watching && sharing ? 'Watching: changed views sent every 8 seconds. ' : ''}Screenshots and selected code are sent to configured AI providers for analysis.</p>
      {readingImage && <p role="status" className="mt-2 text-black/55">Reading screenshot…</p>}
      {(uploadError || repo.captureError) && <p role="alert" className="mt-2 text-[color:var(--stop)]">{uploadError || repo.captureError}</p>}
      {!!repo.snapshot.captures && <details className="mt-2">
        <summary className="cursor-pointer font-medium">Observed code and gaps</summary>
        <div className="mt-2 max-h-44 space-y-2 overflow-auto">
          {summaries.map((file) => <div key={file.path}>
            <p className="break-all font-mono">{file.path}</p>
            <p className="text-[10px] text-black/55">{file.observedLines} observed lines · {file.complete ? 'continuous through visible EOF' : 'partial'}{file.uncertainLines ? ` · ${file.uncertainLines} uncertain` : ''}{file.hasConflicts ? ' · changed / conflicting captures' : ''}</p>
          </div>)}
          <pre className="whitespace-pre-wrap break-words rounded bg-white/60 p-2 font-mono text-[10px]">{screenContext(repo.snapshot, question)}</pre>
        </div>
        <div className="mt-2 flex gap-3">
          <button onClick={exportEvidence} className="flex items-center gap-1 text-emerald-800"><Download size={12} />Export evidence</button>
        </div>
      </details>}
      {navigation.length > 0 && <div className="mt-2 rounded-lg border border-emerald-800/15 bg-white/65 p-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Open next while discussing</p>
        {navigation.slice(0, 2).map((item, i) => <p key={`${item.path}-${i}`} className="mt-1 break-words"><strong className="font-mono">{item.path}</strong><br /><span className="text-black/65">{item.instruction}</span></p>)}
      </div>}
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Specialist tasks">
        {(['plan', 'debug', 'review', 'debrief'] as const).map((task) => <button key={task} disabled={!question.trim() || repo.analysis?.running} className="rounded-full border border-black/15 bg-white/65 px-2.5 py-1 capitalize disabled:opacity-40" onClick={() => onAnalyze(task)}>{task}</button>)}
      </div>
      {canClear && <button onClick={clear} className="mt-2 text-black/55">Clear screen repo</button>}
      {repo.captureModel && <p className="mt-1 text-[10px] text-black/45">Vision: {repo.captureModel}</p>}
    </section>
  )
}

export function RepoAnalysisView({ repo, onRetry }: { repo: ScreenRepo; onRetry?: (question: string, task: RepoTask, questionId?: string) => void }) {
  const analysis = repo.displayAnalysis
  const backgroundAnalysis = repo.analysis?.running && repo.analysis.id !== analysis?.id ? repo.analysis : null
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-label="Repository analysis">
    {repo.history.length > 0 && <label className="mb-3 block text-xs text-black/65">Answer history
      <select value={repo.displayId ?? ''} onChange={(event) => repo.setDisplayId(event.target.value || null)} className="mt-1 w-full rounded-lg border border-black/15 bg-white p-2 text-xs">
        <option value="">Follow current analysis</option>
        {[...repo.history].reverse().map((entry) => <option key={entry.id} value={entry.id}>{entry.task}: {entry.question.slice(0, 100)}{entry.error ? ' (incomplete)' : ''}</option>)}
      </select>
    </label>}
    {backgroundAnalysis && <div className="mb-3 rounded-lg border border-emerald-800/20 bg-emerald-700/5 p-2 text-xs">
      <p role="status" className="break-words">Answering: {backgroundAnalysis.question}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button onClick={() => repo.setDisplayId(null)} className="font-medium text-emerald-800">View current analysis</button>
        <button onClick={repo.stopAnalysis} className="text-black/65">Stop current analysis</button>
      </div>
    </div>}
    {!analysis ? <p className="text-sm text-black/55">Capture the file tree, entry point, implementation, and tests. Then ask a question or select a specialist task.</p> : <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{analysis.question}</p>
        {analysis.running && <button className="text-xs text-black/60" onClick={repo.stopAnalysis}>Stop</button>}
      </div>
      {analysis.revision !== repo.snapshot.revision && <p className="mt-1 text-[11px] text-amber-800">New code was captured after this analysis started. Ask again to include it.</p>}
      <div className="my-3 space-y-1" aria-live="polite">
        {analysis.agents.map((agent) => <details key={agent.role} className="rounded-lg border border-black/10 px-2 py-1.5 text-xs">
          <summary className="cursor-pointer"><span className="font-medium capitalize">{agent.role}</span> · {agent.status}<span className="block text-[10px] text-black/50">{agent.model}{agent.elapsedMs !== undefined ? ` · ${(agent.elapsedMs / 1000).toFixed(1)}s` : ''}</span></summary>
          {agent.text && <div className="mt-2"><Markdown>{agent.text}</Markdown></div>}
        </details>)}
        {analysis.running && !analysis.agents.length && <p className="text-xs text-black/55">Assigning repository specialists…</p>}
      </div>
      {!analysis.answer && analysis.running && analysis.agents.find((agent) => agent.role === 'requirements' && agent.status === 'done')?.text && <div className="mb-3 rounded-xl bg-emerald-700/5 p-3">
        <p className="mb-1 text-xs font-semibold text-emerald-800">Navigation specialist · preliminary guidance</p>
        <Markdown>{analysis.agents.find((agent) => agent.role === 'requirements')!.text!}</Markdown>
      </div>}
      {analysis.error && <div className="mb-2">
        <p role="alert" className="text-xs text-[color:var(--stop)]">{analysis.error}</p>
        {onRetry && <button disabled={!!repo.analysis?.running} onClick={() => onRetry(analysis.question, analysis.task, analysis.questionId)} className="btn-ghost mt-2 px-2 py-1 text-xs disabled:opacity-40">Retry analysis</button>}
      </div>}
      <Markdown>{analysis.answer}</Markdown>
      {analysis.running && <p className="mt-2 text-xs text-emerald-800">Analysis in progress…</p>}
    </>}
  </div>
}
