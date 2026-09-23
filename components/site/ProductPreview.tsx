'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, AudioLines, BookOpen, Check, Code2, FlaskConical, FolderCode, MessageSquare, Radio, Settings2, Sparkles } from 'lucide-react'
import styles from './Site.module.css'

type Preview = 'live' | 'copilot' | 'mock'
const previews = [
  { id: 'live' as const, label: 'Live interview', icon: Radio, href: '/interview', action: 'Open Live', caption: 'Keep the question, answer and conversation together.' },
  { id: 'copilot' as const, label: 'AI workspace', icon: Sparkles, href: '/copilot', action: 'Open AI workspace', caption: 'Work through a question or codebase without starting a meeting.' },
  { id: 'mock' as const, label: 'Mock Lab', icon: FlaskConical, href: '/interview#mock', action: 'Open Mock Lab', caption: 'Test the same answer pipeline you use in Live.' },
]

export function ProductPreview() {
  const [selected, setSelected] = useState<Preview>('live')
  const preview = previews.find((item) => item.id === selected)!
  return (
    <div className={styles.previewFrame}>
      <div className={styles.previewToolbar}>
        <div className={styles.previewTabs} role="group" aria-label="Explore product examples">
          {previews.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={selected === id} aria-controls="product-example" onClick={() => setSelected(id)}>
              <Icon size={14} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <span className={styles.previewLabel}><BookOpen size={12} aria-hidden="true" /> Illustrative session</span>
      </div>
      <div id="product-example" className={styles.preview} aria-label={`${preview.label} example`}>
        <aside className={styles.previewSidebar} aria-label="Example workspace navigation">
          <div className={styles.previewBrand}>LiveTranscript</div>
          <div className={styles.previewNavLabel}>Interview</div>
          <span className={styles.previewNavItem} data-active={selected === 'live'}><Radio size={13} aria-hidden="true" />Live</span>
          <span className={styles.previewNavItem} data-active={selected === 'mock'}><FlaskConical size={13} aria-hidden="true" />Mock Lab</span>
          <span className={styles.previewNavItem}><Check size={13} aria-hidden="true" />Feedback</span>
          <div className={styles.previewNavLabel}>Workspace</div>
          <span className={styles.previewNavItem} data-active={selected === 'copilot'}><Sparkles size={13} aria-hidden="true" />AI workspace</span>
          <span className={styles.previewNavItem}><FolderCode size={13} aria-hidden="true" />Repository</span>
          <span className={styles.previewNavItem}><MessageSquare size={13} aria-hidden="true" />Transcripts</span>
          <div className={styles.previewNavLabel}>Preferences</div>
          <span className={styles.previewNavItem}><Settings2 size={13} aria-hidden="true" />Settings</span>
        </aside>
        {selected === 'live' && <LivePreview />}
        {selected === 'copilot' && <CopilotPreview />}
        {selected === 'mock' && <MockPreview />}
      </div>
      <div className={styles.previewCaption}>
        <span>{preview.caption} Sample content, no recording in progress.</span>
        <Link href={preview.href}>{preview.action}<ArrowRight size={13} aria-hidden="true" /></Link>
      </div>
    </div>
  )
}

function LivePreview() {
  return (
    <div className={`${styles.previewContent} ${styles.darkPreview}`}>
      <div className={styles.previewTopbar}>
        <div className={styles.previewSession}><span><Code2 size={14} aria-hidden="true" /></span>System design · Technical interview</div>
        <span className={styles.livePill}>Live view example</span>
      </div>
      <div className={styles.liveGrid}>
        <div className={styles.answerPreview}>
          <span className={styles.previewTag}>Current question · System design</span>
          <h3>How would you design a distributed notification service?</h3>
          <div className={styles.answerPaper}>
            <div className={styles.answerHeading}><Sparkles size={14} aria-hidden="true" />Answer outline</div>
            <p>Start with delivery requirements, then separate accepting a notification from delivering it.</p>
            <ol>
              <li><span>1</span><div><strong>Clarify the contract</strong><br />Channels, volume, delivery guarantees and user preferences.</div></li>
              <li><span>2</span><div><strong>Decouple the delivery path</strong><br />An API accepts requests; a durable queue feeds channel workers.</div></li>
              <li><span>3</span><div><strong>Make failure recoverable</strong><br />Idempotency keys, bounded retries and a dead-letter queue.</div></li>
            </ol>
          </div>
          <p className={styles.answerFootnote}>A structure to reason from. Add your own experience and trade-offs.</p>
        </div>
        <aside className={styles.transcriptPreview}>
          <h4>Conversation</h4>
          <div className={styles.transcriptTurn}><div><span>Interviewer</span><span>00:24</span></div>Let&rsquo;s talk about a service that supports email, SMS and push.</div>
          <div className={styles.transcriptTurn}><div><span>You</span><span>00:31</span></div>What scale and delivery guarantees should we plan for?</div>
          <div className={styles.transcriptTurn} data-current="true"><div><span>Interviewer</span><span>00:42</span></div>How would you design a distributed notification service?</div>
          <div className={styles.transcriptStatus}><AudioLines size={22} aria-hidden="true" />Mic + system audio</div>
        </aside>
      </div>
    </div>
  )
}

function CopilotPreview() {
  return (
    <div className={`${styles.previewContent} ${styles.darkPreview} ${styles.aiPreview}`}>
      <span className={styles.previewTag}>System design mode</span>
      <h3 className="mt-3">Room to think it through.</h3>
      <div className={styles.aiPrompt}><MessageSquare size={15} aria-hidden="true" />When should I use a queue instead of synchronous calls?</div>
      <div className={styles.answerPaper}>
        <div className={styles.answerHeading}><Sparkles size={14} aria-hidden="true" />Compare the trade-offs</div>
        <p>A queue helps when work can finish later, traffic arrives in bursts, or downstream failures should not block a request.</p>
        <ol>
          <li><span>+</span><div><strong>Queues absorb bursts</strong><br />Workers can process jobs independently. Track queue age as well as depth.</div></li>
          <li><span>±</span><div><strong>They introduce operational work</strong><br />Plan for retries, ordering, duplicate delivery and observability.</div></li>
          <li><span>→</span><div><strong>Keep synchronous calls when a result is required now</strong><br />Use timeouts and clear failure handling across service boundaries.</div></li>
        </ol>
      </div>
      <p className={styles.answerFootnote}>Standalone questions · Technical modes · Optional audio context</p>
    </div>
  )
}

function MockPreview() {
  return (
    <div className={`${styles.previewContent} ${styles.mockPreview}`}>
      <h3>Mock Lab</h3>
      <p className={styles.previewSubtitle}>Test and tune your live answer profile.</p>
      <div className={styles.mockSteps}><span>Test scenario</span><span>Review result</span><span>Apply to Live</span></div>
      <div className={styles.mockQuestion}><small>System design · Sample scenario</small>Design a notification service that stays reliable during a sudden spike in traffic.</div>
      <div className={styles.mockResult}>
        <div><h4>Example answer</h4><p>Buffer incoming work in a durable queue. Scale workers by queue age and throughput, while keeping provider limits and per-user preferences explicit.</p><p>Use idempotent delivery and bounded retries to recover safely.</p></div>
        <div><h4>Your review criteria</h4><ul><li><Check size={12} aria-hidden="true" />Explains the delivery path</li><li><Check size={12} aria-hidden="true" />Addresses retries and duplicates</li><li><Check size={12} aria-hidden="true" />Discusses meaningful trade-offs</li></ul><p>Criteria stay separate from the answer prompt.</p></div>
      </div>
      <p className={styles.previewSubtitle}>Review a completed run before applying a tuned profile to Live.</p>
    </div>
  )
}
