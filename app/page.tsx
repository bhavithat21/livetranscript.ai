import Link from 'next/link'

export const metadata = { title: 'Start your interview — LiveTranscript' }
export default function Home() {
  return <main style={{ maxWidth: 520, margin: '15vh auto', padding: 24 }}>
    <h1 style={{ fontSize: 36, marginBottom: 16 }}>Ready for your interview?</h1>
    <p style={{ lineHeight: 1.7, marginBottom: 28 }}>Start the conversation, choose a screen to share, and keep your next action, spoken answer, and code together. No programming language setup needed.</p>
    <Link href="/interview#live" style={{ display: 'inline-block', padding: '16px 24px', borderRadius: 10, background: '#dce981', color: '#18200d', fontWeight: 650 }}>Start live interview</Link>
    <p style={{ marginTop: 28 }}><Link href="/dashboard">Past transcripts</Link> · <Link href="/settings">Settings</Link></p>
  </main>
}
