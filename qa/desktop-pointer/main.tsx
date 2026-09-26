import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { TitleBar } from '../../components/TitleBar'
import { calls, nativeChange } from './bridge'
import '../../app/globals.css'
import './qa.css'
declare global { interface Window { __pointerQA: { calls: typeof calls; nativeChange: typeof nativeChange }; __pointerDesktop?: boolean } }
if (window.__pointerDesktop !== false) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  document.documentElement.classList.add('lt-desktop')
}
window.__pointerQA = { calls, nativeChange }
function App() {
  const [count, setCount] = useState(0)
  return <><TitleBar /><main className="pointer-fixture"><p className="notice">Desktop pointer QA · real controls and CSS · mocked native state, not OS click-through</p>
    <h1>Mouse interaction</h1><p>Fixed arrow in LiveTranscript content. Pass-through routes mouse input to the underlying window in the native app.</p>
    <section><button id="click-test" onClick={() => setCount(count + 1)}>Clickable button <svg viewBox="0 0 10 10" width="12"><path d="M0 0L10 10" /></svg></button><output id="click-count">{count} clicks</output><button id="disabled" disabled>Disabled button</button>
      <a id="link" href="#reader">Transcript link</a><label htmlFor="input">Editable input</label><input id="input" defaultValue="Continue typing" />
      <label htmlFor="textarea">Notes</label><textarea id="textarea" defaultValue="Text stays editable with an arrow." />
      <label htmlFor="select">Mode</label><select id="select"><option>Interactive</option><option>Review</option></select>
      <input id="range" type="range" aria-label="Text size" /><details><summary id="summary">Show context</summary><p>Nested content.</p></details>
      <div id="resize" style={{ cursor: 'ew-resize' }}>App resize-handle style override</div>
      <div id="reader" className="reader-surface">Selectable transcript words.</div><div id="edit" contentEditable suppressContentEditableWarning>Editable code</div>
    </section><p>Native window borders, other applications, permission dialogs, and operating-system cursors are outside this CSS scope.</p>
  </main></>
}
createRoot(document.getElementById('root')!).render(<App />)
