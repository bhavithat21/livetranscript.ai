'use client'
import { useState } from 'react'
import type { InterviewSession } from '@/lib/interview/session'
import { REFERENCE_VIDEO, youtubeReference } from '@/lib/interview/videoReference'
import { LiveInterview } from './LiveInterview'
import styles from '@/components/coach/RepositoryCoach.module.css'

export function VideoTest({blocked,visible,onActivity,onComplete}:{blocked:boolean;visible:boolean;onActivity:(active:boolean)=>void;onComplete:(session:InterviewSession)=>void}) {
  const [input,setInput]=useState(REFERENCE_VIDEO),[source,setSource]=useState(youtubeReference(REFERENCE_VIDEO)),[preview,setPreview]=useState(false),[active,setActive]=useState(false),[error,setError]=useState('')
  return <div className={styles.root}>
    <section className={styles.card} aria-label="Video test source">
      <h2>Test with a coding video</h2>
      <p className={styles.muted}>Use the real Live speech, screen-reading, and repository-agent pipeline. Pasting a link does not download, transcribe, or test it automatically.</p>
      <label className={styles.label}>YouTube video<input className={styles.input} value={input} onChange={e=>setInput(e.target.value)} disabled={active} maxLength={1000}/></label>
      <div className={styles.feedback}><button className={styles.button} disabled={active} onClick={()=>{try{setSource(youtubeReference(input));setError('');setPreview(false)}catch(e){setError(e instanceof Error?e.message:'Invalid video link')}}}>Use video</button><a className={styles.button} href={source.url} target="_blank" rel="noopener noreferrer">Open video in separate tab</a><button className={styles.button} onClick={()=>setPreview(v=>!v)} disabled={active}>{preview?'Hide preview':'Preview video'}</button></div>
      {preview&&<iframe title="Coding video reference" src={source.embed} allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{width:'100%',aspectRatio:'16 / 9',border:0}}/>}
      <p>Open the video in its own tab and play at normal speed. Start below and share that tab’s audio. In the coach, choose <strong>Share IDE</strong> and select the same video tab for the coding screen. Assign the interviewer in <strong>Speakers</strong>; both voices initially arrive on system audio.</p>
      <p className={styles.muted}>Pause at a question to inspect Say now / Look at / Change / Verify. Mark a response Useful or Needs work, then pause the coach to run its learning loop. Export replay + feedback before ending. This tab does not control YouTube playback or grant access to hidden source files.</p>
      {error&&<p role="alert">{error}</p>}
    </section>
    <LiveInterview key={source.id} videoTest visible={visible} blocked={blocked} onActivity={value=>{setActive(value);onActivity(value)}} onComplete={session=>onComplete({...session,kind:'tuning',title:'Video coding-agent test',captureNote:`VIDEO PLAYBACK TEST, reference ${source.url}. Captured through the user-selected audio source. Video choice is user-supplied metadata, not proof the correct tab was shared. ASR and agent quality are not independently scored by playback alone. Export the repository replay separately for model responses and reviews. ${session.captureNote}`})}/>
  </div>
}
